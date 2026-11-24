/** The isolated backend on a fixed port, for `npm run test:e2e:live`. Loopback only; see local-backend.ts. */
import { createServer } from "node:http";
import { LocalBackend } from "./local-backend.ts";

const backend = await LocalBackend.start();
await backend.listen(3199);
/* The test's own door: synthetic users, operator SQL, and what was refused. */
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { op, ...a } = JSON.parse(body || "{}") as { op?: string; email?: string; text?: string; args?: unknown[] };
      let out: unknown = null;
      if (op === "user") {
        const u = await backend.addUser(a.email ?? "");
        out = { ...u, session: backend.session(u) };
      } else if (op === "sql") out = await backend.sql(a.text ?? "", a.args ?? []);
      else if (op === "errors") out = backend.errors.splice(0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
}).listen(3198, "127.0.0.1");
/**
 * A synthetic model: the smallest answer each schema allows. It tests the path
 * (gates, recording, parsing, what the screen does next), never the prompts.
 */
type Schema = { type?: string; enum?: unknown[]; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[] };
const least = (s: Schema): unknown =>
  s.enum ? s.enum[0] : s.anyOf ? least(s.anyOf[0]!) : s.type === "object" ? Object.fromEntries((s.required ?? Object.keys(s.properties ?? {})).map((k) => [k, least(s.properties![k]!)])) : s.type === "array" ? [] : s.type === "number" || s.type === "integer" ? 1 : s.type === "boolean" ? false : s.type === "null" ? null : "Synthetic answer";
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = JSON.parse(body || "{}") as { model?: string; stream?: boolean; output_config?: { format?: { schema?: Schema } } };
    const text = JSON.stringify(least(b.output_config?.format?.schema ?? { type: "object" }));
    const message = { id: "msg_synthetic", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    if (!b.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(message));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (type: string, data: object) => res.write(`event: ${type}
data: ${JSON.stringify({ type, ...data })}

`);
    ev("message_start", { message: { ...message, content: [], stop_reason: null } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
    ev("message_stop", {});
    res.end();
  });
}).listen(3197, "127.0.0.1");
console.log("local backend ready");
