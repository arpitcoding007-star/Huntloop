/**
 * The one place in Huntloop that talks to a model.
 *
 * Everything above this file works against `ModelClient`, which is a four-field
 * interface. That indirection buys two specific things and is not there for
 * abstraction's sake:
 *
 *   · The task tests run with a scripted client, so §7's rules are proven
 *     without a key, without a network, and without spending money on CI.
 *   · Plan D5 accepts a single-provider dependency but asks that the swap be
 *     *possible*. This is the seam. It is ~40 lines, not a provider framework.
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropicApiKey } from "./env.ts";
import { capabilities, type Effort, type ModelId, type TokenUsage } from "./models.ts";

export interface ModelRequest {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  /** Stable, cached prefix. Never interpolate per-call values into this. */
  system: string;
  /** The per-call payload. Placed after the cache breakpoint. */
  userContent: string;
  /** JSON Schema the response is constrained to (`output_config.format`). */
  schema: Record<string, unknown>;
  /**
   * When set, the model may fetch pages — restricted to these hosts.
   *
   * The allow-list is the point. `web_fetch` will only retrieve URLs already
   * present in the conversation, but "already present" includes URLs the model
   * read on a page it just fetched, so an untrusted page can otherwise walk the
   * model to a host we never intended it to visit.
   */
  fetchDomains?: string[];
}

export interface ModelResult {
  /** The structured output, already parsed. Validation is the caller's job. */
  json: unknown;
  usage: TokenUsage;
  model: string;
}

export interface ModelClient {
  run(request: ModelRequest): Promise<ModelResult>;
}

export class ModelRefusalError extends Error {
  /** The policy category, when the API reports one. */
  category: string | null;

  constructor(category: string | null) {
    super(
      `The model declined this request${category ? ` (${category})` : ""}. ` +
        "This is an answer, not an outage — surface it rather than retrying.",
    );
    this.name = "ModelRefusalError";
    this.category = category;
  }
}

/** A server tool paused the turn more times than we are willing to resume. */
const MAX_CONTINUATIONS = 5;

export function createAnthropicClient(): ModelClient {
  const anthropic = new Anthropic({ apiKey: anthropicApiKey() });

  return {
    async run(request: ModelRequest): Promise<ModelResult> {
      const caps = capabilities(request.model);
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: "user", content: request.userContent },
      ];

      const tools =
        request.fetchDomains && caps.webFetch
          ? [
              {
                type: "web_fetch_20260209" as const,
                name: "web_fetch" as const,
                max_uses: 8,
                allowed_domains: request.fetchDomains,
              },
            ]
          : undefined;

      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      let message: Anthropic.Beta.BetaMessage | undefined;

      for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
        const stream = anthropic.beta.messages.stream({
          model: request.model,
          max_tokens: request.maxTokens,
          // Server-side fallback: safety classifiers can decline a request, and
          // for a tool that researches arbitrary companies that is a live
          // scenario rather than a theoretical one — a security vendor's own
          // website is exactly the kind of page a cyber classifier reacts to.
          // "default" lets Anthropic route by refusal category instead of us
          // pinning a substitute model that will later be deprecated.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [
            {
              type: "text",
              text: request.system,
              // §7.2's biggest lever. The system prompt is byte-identical
              // across every company researched under one ICP, so this block
              // should be billing at 0.1x from the second call onward. It only
              // works if nothing per-call ever reaches `system` — see the
              // contract on ModelRequest.
              cache_control: { type: "ephemeral" },
            },
          ],
          ...(caps.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
          output_config: {
            ...(caps.effort ? { effort: request.effort } : {}),
            format: { type: "json_schema" as const, schema: request.schema },
          },
          ...(tools ? { tools } : {}),
          messages,
        });

        message = await stream.finalMessage();
        accumulate(usage, message.usage);

        if (message.stop_reason === "refusal") {
          throw new ModelRefusalError(message.stop_details?.category ?? null);
        }
        // A server tool hit its per-turn iteration cap. Re-send with the
        // assistant turn appended and the server resumes where it stopped; do
        // not add a "continue" message, which the API does not expect here.
        if (message.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: message.content });
          continue;
        }
        if (message.stop_reason === "max_tokens") {
          throw new Error(
            `Response hit max_tokens (${request.maxTokens}) before finishing. ` +
              "On this model max_tokens caps thinking and output together, so " +
              "raise it or lower the effort rather than parsing a truncated answer.",
          );
        }
        break;
      }

      if (!message) throw new Error("No response from the model.");
      if (message.stop_reason === "pause_turn") {
        throw new Error(
          `Still paused after ${MAX_CONTINUATIONS} continuations — the fetch ` +
            "loop is not converging. Failing rather than billing indefinitely.",
        );
      }

      return { json: parseStructuredOutput(message), usage, model: message.model };
    },
  };
}

function accumulate(into: TokenUsage, usage: Anthropic.Beta.BetaUsage): void {
  into.inputTokens += usage.input_tokens ?? 0;
  into.outputTokens += usage.output_tokens ?? 0;
  into.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  into.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * Pulls the JSON out of a constrained response.
 *
 * With `output_config.format` the model cannot emit invalid JSON, so a parse
 * failure here means something structural changed — not that the model had a
 * bad day. Saying so in the error saves the next person an hour.
 */
function parseStructuredOutput(message: Anthropic.Beta.BetaMessage): unknown {
  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    throw new Error(
      `The response carried no text block (stop_reason: ${message.stop_reason}).`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "A schema-constrained response did not parse as JSON. The request was " +
        "not constrained the way this code assumes — check output_config.format.",
    );
  }
}
