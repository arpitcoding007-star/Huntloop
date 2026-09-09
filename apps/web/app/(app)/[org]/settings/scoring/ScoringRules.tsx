"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormMessage,
  Input,
  SectionLabel,
  Select,
  Textarea,
} from "@huntloop/ui";
import { FlaskConical, Plus, RefreshCw, Save, Scale, Sparkles, Trash2 } from "lucide-react";
import type { RuleField, RuleOperator } from "@huntloop/db/rules";
import type { Rule, RuleSet } from "../../../../../lib/data/scoring";
import {
  deleteRuleAction,
  draftRulesAction,
  previewRuleAction,
  recomputeScoresAction,
  saveRuleAction,
  setRuleActiveAction,
  type RuleInput,
} from "./actions";

/**
 * Authoring and reviewing scoring rules.
 *
 * ── Three things this screen exists to make impossible ───────────────────
 *
 * **Activating something you have not read.** Nothing here activates in bulk.
 * A proposal — drafted by the model, learned from an analysis, or typed by
 * hand — arrives inactive and is switched on one at a time. The reference
 * system Huntloop is a second draft of auto-activated every pending rule when
 * a user clicked Finish on an onboarding step, which made "approve everything"
 * the default action of a review screen.
 *
 * **Believing a rule does something it does not.** Every rule renders as an
 * English sentence generated from the stored shape by `describeRule` — the
 * same function the engine's own trace uses — so the sentence cannot drift
 * from what will be evaluated. A rule whose expression no longer parses is
 * shown, flagged, and stated to be not running, rather than hidden.
 *
 * **Writing a rule that matches nothing.** "Test it" runs the real evaluator
 * against real recent opportunities and says how many it would have hit. A
 * condition on `company.industry` matches nothing at all on a deployment where
 * nobody fills that column in, and no amount of reading the rule reveals that.
 *
 * ── The fields, and what each one is for ─────────────────────────────────
 *
 * `intent` is a label. It groups rules on this screen and is never read by
 * anything that computes — the effect is `effect`, and the two are separate
 * inputs because a taxonomy that silently changes behaviour is decoration that
 * reads like configuration.
 */
export function ScoringRules({
  org,
  rules,
  canWrite,
}: {
  org: string;
  rules: RuleSet;
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [drafting, startDraft] = useTransition();
  const [rescoring, startRescore] = useTransition();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[20px] font-semibold text-fg">Scoring rules</h2>
        <p className="mt-1 max-w-[60ch] text-[13px] text-fg-muted">
          Huntloop qualifies every company against your profile and gives it a
          score. These are the things you know that a qualification cannot work
          out on its own — who you never sell to, what always deserves a look.
          They run after the model, and what each one did is recorded on the
          score.
        </p>
      </div>

      <FormMessage result={result} />

      <div className="flex flex-wrap items-center gap-2">
        {canWrite && !adding && (
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
            Write a rule
          </Button>
        )}
        {canWrite && (
          <Button
            size="sm"
            variant="ghost"
            icon={Sparkles}
            disabled={drafting}
            onClick={() =>
              startDraft(async () => {
                const res = await draftRulesAction(org);
                setResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          >
            {drafting ? "Drafting…" : "Draft from my ICP"}
          </Button>
        )}
        {canWrite && (
          /* Rules apply from the next time a company is scored, which for an
             existing pipeline is "whenever something happens to it". Without
             this button a rule edit silently produces a list mixing verdicts
             from before and after the change, ranked together. */
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            disabled={rescoring}
            onClick={() =>
              startRescore(async () => {
                const res = await recomputeScoresAction(org);
                setResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          >
            {rescoring ? "Starting…" : "Rescore all opportunities"}
          </Button>
        )}
      </div>
      {canWrite && (
        <p className="max-w-[60ch] text-[12px] text-fg-muted">
          Rescoring runs one model call per opportunity, in batches, and each
          opportunity keeps the score it has until its new one is ready.
        </p>
      )}

      {adding && (
        <RuleForm
          org={org}
          rule={null}
          canWrite={canWrite}
          onDone={() => setAdding(false)}
          onResult={setResult}
        />
      )}

      <section>
        <SectionLabel>Waiting for you</SectionLabel>
        <p className="mt-2 max-w-[60ch] text-[12px] text-fg-muted">
          Nothing here is affecting any score. Read one, test it against your
          recent opportunities, and turn it on if it says what you meant.
        </p>
        <div className="mt-3 space-y-3">
          {rules.proposed.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={Scale}
                  title="Nothing waiting"
                  description="Rules you write, rules drafted from your ICP, and rules an analysis proposed all arrive here first."
                />
              </CardBody>
            </Card>
          ) : (
            rules.proposed.map((rule) =>
              editing === rule.id ? (
                <RuleForm
                  key={rule.id}
                  org={org}
                  rule={rule}
                  canWrite={canWrite}
                  onDone={() => setEditing(null)}
                  onResult={setResult}
                />
              ) : (
                <RuleCard
                  key={rule.id}
                  org={org}
                  rule={rule}
                  canWrite={canWrite}
                  onEdit={() => setEditing(rule.id)}
                  onResult={setResult}
                />
              ),
            )
          )}
        </div>
      </section>

      <section>
        <SectionLabel>Running</SectionLabel>
        <p className="mt-2 max-w-[60ch] text-[12px] text-fg-muted">
          Applied every time a company is scored, after the qualification. The
          score kept on each opportunity records what the model said before
          these ran, so turning one off does not rewrite history.
        </p>
        <div className="mt-3 space-y-3">
          {rules.active.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={Scale}
                  title="No rules are running"
                  description="Every verdict is the qualifier's own judgement against your profile. That is a reasonable default and a poor destination."
                />
              </CardBody>
            </Card>
          ) : (
            rules.active.map((rule) =>
              editing === rule.id ? (
                <RuleForm
                  key={rule.id}
                  org={org}
                  rule={rule}
                  canWrite={canWrite}
                  onDone={() => setEditing(null)}
                  onResult={setResult}
                />
              ) : (
                <RuleCard
                  key={rule.id}
                  org={org}
                  rule={rule}
                  canWrite={canWrite}
                  onEdit={() => setEditing(rule.id)}
                  onResult={setResult}
                />
              ),
            )
          )}
        </div>
      </section>
    </div>
  );
}

const ORIGIN_LABEL: Record<Rule["origin"], string> = {
  user: "You wrote this",
  drafted: "Drafted from your ICP",
  learned: "From an analysis",
};

function RuleCard({
  org,
  rule,
  canWrite,
  onEdit,
  onResult,
}: {
  org: string;
  rule: Rule;
  canWrite: boolean;
  onEdit: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();
  const demo = rule.id.startsWith("demo-");

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-fg">{rule.name}</span>
          {rule.intent && <Badge variant="neutral">{rule.intent}</Badge>}
          {rule.effect === "veto" && <Badge variant="danger">excludes</Badge>}
          {rule.malformed && <Badge variant="warning">not running</Badge>}
        </div>

        <p className="text-[13px] text-fg-secondary">{rule.summary}</p>

        {rule.malformed && (
          <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[12px] text-fg">
            This rule can no longer be read, so the engine skips it:{" "}
            {rule.malformed} Edit it or remove it.
          </p>
        )}

        {rule.rationale && <p className="text-[12px] text-fg-muted">{rule.rationale}</p>}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
          <span>{ORIGIN_LABEL[rule.origin]}</span>
          {rule.basis && <span>· from “{rule.basis}”</span>}
        </div>

        {canWrite && !demo && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={rule.isActive ? "ghost" : "primary"}
              disabled={pending || Boolean(rule.malformed)}
              onClick={() =>
                start(async () => {
                  const res = await setRuleActiveAction(org, rule.id, !rule.isActive);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            >
              {rule.isActive ? "Turn off" : "Turn on"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label={`Remove ${rule.name}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteRuleAction(org, rule.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Authoring ───────────────────────────────────────────────────────────── */

/**
 * The fields a condition may name, mirrored for the browser.
 *
 * `@huntloop/db/rules` is importable here — it is pure and has no client — but
 * these carry a plain-English gloss beside each one, which is UI copy and
 * belongs with the control. The union type keeps a divergence a type error.
 */
const FIELDS: { value: RuleField; label: string }[] = [
  { value: "company.employee_count", label: "Headcount" },
  { value: "company.industry", label: "Industry" },
  { value: "company.country", label: "Country" },
  { value: "company.region", label: "Region" },
  { value: "company.business_model", label: "Business model" },
  { value: "company.description", label: "What they say they do" },
  { value: "company.tech_stack", label: "Technology they use" },
  { value: "company.name", label: "Company name" },
  { value: "company.domain", label: "Domain" },
  { value: "evidence.claims", label: "Something Huntloop observed" },
  { value: "signals.event_types", label: "Kind of signal seen" },
  { value: "score.model_score", label: "The qualifier's score" },
  { value: "score.priority", label: "The qualifier's priority" },
];

const OPERATORS: { value: RuleOperator; label: string; takesValue: boolean }[] = [
  { value: "equals", label: "is exactly", takesValue: true },
  { value: "includes", label: "mentions", takesValue: true },
  { value: "gte", label: "is at least", takesValue: true },
  { value: "lte", label: "is at most", takesValue: true },
  { value: "exists", label: "is known", takesValue: false },
  { value: "missing", label: "is not known", takesValue: false },
];

/**
 * One condition, not a nested expression builder.
 *
 * The language supports `all`/`any`/`not` and this form does not offer them.
 * That is deliberate for a first version: a rule builder with nesting is a
 * query builder, and the failure it invites — a four-deep condition nobody
 * reviewing can hold in their head — is the one `MAX_DEPTH` exists to bound.
 * A rule needing two conditions is two rules, and two rules are individually
 * reviewable and individually switchable, which is better than one that is
 * neither.
 *
 * Drafted and learned rules can carry nesting, because a model composing one
 * is not the same risk as a person building one by clicking. Those render as
 * their generated sentence and are edited by replacing them.
 */
function RuleForm({
  org,
  rule,
  canWrite,
  onDone,
  onResult,
}: {
  org: string;
  rule: Rule | null;
  canWrite: boolean;
  onDone: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const simple = rule && "field" in rule.expression ? rule.expression : null;

  const [name, setName] = useState(rule?.name ?? "");
  const [field, setField] = useState(simple?.field ?? "company.employee_count");
  const [op, setOp] = useState(simple?.op ?? "gte");
  const [value, setValue] = useState(
    simple && "value" in simple && simple.value !== undefined ? String(simple.value) : "",
  );
  const [effect, setEffect] = useState<RuleInput["effect"]>(rule?.effect ?? "adjust");
  const [weight, setWeight] = useState(rule?.weight !== null && rule?.weight !== undefined ? String(rule.weight) : "10");
  const [floorPriority, setFloorPriority] = useState<"hot" | "warm" | "watch">(
    rule?.floorPriority && rule.floorPriority !== "ignore" ? rule.floorPriority : "warm",
  );
  const [intent, setIntent] = useState<RuleInput["intent"]>(rule?.intent ?? null);
  const [rationale, setRationale] = useState(rule?.rationale ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const operator = OPERATORS.find((o) => o.value === op);
  const nested = Boolean(rule && !simple);

  const build = (): RuleInput => ({
    id: rule?.id && !rule.id.startsWith("demo-") ? rule.id : undefined,
    name,
    effect,
    weight: effect === "adjust" ? Number(weight) : null,
    floorPriority: effect === "floor" ? floorPriority : null,
    intent,
    rationale,
    expression:
      nested && rule
        ? rule.expression
        : operator?.takesValue
          ? {
              field,
              op,
              // Numbers stay numbers: `gte`/`lte` compare numerically and a
              // string "50" would still work, but storing it as text makes the
              // rule read wrongly everywhere it is shown.
              value: op === "gte" || op === "lte" ? Number(value) : value,
            }
          : { field, op },
  });

  return (
    <Card>
      <CardHeader
        title={rule ? "Edit rule" : "Write a rule"}
        description="Saved switched off. Nothing changes until you turn it on."
      />
      <CardBody className="space-y-5">
        <Field label="Name" required error={fieldErrors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="Too small to have a budget"
            />
          )}
        </Field>

        {nested ? (
          <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
            <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Condition
            </p>
            <p className="mt-1 text-[13px] text-fg">{rule?.summary}</p>
            <p className="mt-1 text-[12px] text-fg-muted">
              This rule combines several conditions, which this form does not
              edit. Its effect below is editable; to change the condition,
              remove it and write a new one.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="When" error={fieldErrors.expression}>
              {(a) => (
                <Select
                  {...a}
                  value={field}
                  onChange={(e) => setField(e.target.value as RuleField)}
                  disabled={!canWrite || pending}
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Test">
              {(a) => (
                <Select
                  {...a}
                  value={op}
                  onChange={(e) => setOp(e.target.value as RuleOperator)}
                  disabled={!canWrite || pending}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {operator?.takesValue && (
              <Field label="Value">
                {(a) => (
                  <Input
                    {...a}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!canWrite || pending}
                    placeholder={op === "gte" || op === "lte" ? "50" : "fintech"}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        <Field
          label="Then"
          hint={
            effect === "veto"
              ? "A hard exclusion. Nothing outweighs it, which is why it is not a large penalty."
              : effect === "floor"
                ? "Raises the priority to at least this. Never lowers it."
                : "Adds or subtracts from the score the qualifier gave."
          }
        >
          {(a) => (
            <Select
              {...a}
              value={effect}
              onChange={(e) => setEffect(e.target.value as RuleInput["effect"])}
              disabled={!canWrite || pending}
            >
              <option value="adjust">Adjust the score</option>
              <option value="floor">Treat it as at least…</option>
              <option value="veto">Never consider it</option>
            </Select>
          )}
        </Field>

        {effect === "adjust" && (
          <Field
            label="Points"
            hint="Between -40 and 40. ±5 is a nudge, ±20 is an opinion, ±40 decides the verdict by itself."
            error={fieldErrors.weight}
          >
            {(a) => (
              <Input
                {...a}
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                disabled={!canWrite || pending}
              />
            )}
          </Field>
        )}

        {effect === "floor" && (
          <Field label="At least" error={fieldErrors.floorPriority}>
            {(a) => (
              <Select
                {...a}
                value={floorPriority}
                onChange={(e) => setFloorPriority(e.target.value as "hot" | "warm" | "watch")}
                disabled={!canWrite || pending}
              >
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="watch">Watch</option>
              </Select>
            )}
          </Field>
        )}

        <Field
          label="Group under"
          hint="A label for this screen only. It has no effect on how the rule is applied."
        >
          {(a) => (
            <Select
              {...a}
              value={intent ?? ""}
              onChange={(e) =>
                setIntent((e.target.value || null) as RuleInput["intent"])
              }
              disabled={!canWrite || pending}
            >
              <option value="">Ungrouped</option>
              <option value="prioritize">Prioritize</option>
              <option value="reject">Reject</option>
              <option value="boost">Boost</option>
              <option value="penalty">Penalty</option>
            </Select>
          )}
        </Field>

        <Field
          label="Why"
          hint="What you know that makes this worth encoding. Read by whoever inherits this account."
          error={fieldErrors.rationale}
        >
          {(a) => (
            <Textarea
              {...a}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              disabled={!canWrite || pending}
              rows={2}
              placeholder="Nobody under ten people has a budget line for this."
            />
          )}
        </Field>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={Save}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setFieldErrors({});
                  const res = await saveRuleAction(org, build());
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (res.ok) onDone();
                  else setFieldErrors(res.fieldErrors ?? {});
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="secondary"
              icon={FlaskConical}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setFieldErrors({});
                  const res = await previewRuleAction(org, build());
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (!res.ok) setFieldErrors(res.fieldErrors ?? {});
                })
              }
            >
              Test it
            </Button>
            <Button variant="ghost" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        )}

        <p className="text-[12px] text-fg-muted">
          Testing runs this against your 50 most recently scored opportunities
          using company facts only — it cannot check conditions about observed
          evidence or signals, so a rule using those will report no matches here
          and may still fire in the engine.
        </p>
      </CardBody>
    </Card>
  );
}
