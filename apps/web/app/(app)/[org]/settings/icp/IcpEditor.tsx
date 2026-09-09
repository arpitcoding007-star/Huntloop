"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Input,
  ListInput,
  SectionLabel,
  Select,
  Textarea,
  joinList,
  splitList,
} from "@huntloop/ui";
import { Check, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import type { IcpRecord, Persona } from "../../../../../lib/data/icp";
import type { Product } from "../../../../../lib/data/product";
import { LookAlikeResult } from "../../../../_components/LookAlikeResult";
import type { LookAlikePreview } from "../../../../../lib/data/look-alike-preview";
import {
  activateIcpAction,
  deleteIcpAction,
  deletePersonaAction,
  previewLookAlikesAction,
  saveIcpAction,
  savePersonaAction,
} from "./actions";

/**
 * The ICP editor — master context §9.
 *
 * Two things §9 asks for that a generic CRUD screen would lose:
 *
 *   · **A small number of high-value questions.** Five lists, not thirty
 *     fields. `IcpStep` in onboarding makes the same argument: a long form
 *     gets filled with guesses, and a guess stored as criteria is
 *     indistinguishable from knowledge the next time anything reads it.
 *   · **Exclusions are their own question**, not negated inclusions. They get
 *     their own field here because they have their own column, and because
 *     §78 needs them separable to stop a strong trigger lifting a company the
 *     user already said is not a fit.
 *
 * Which ICP is being edited is client state rather than a route parameter.
 * Most orgs have exactly one, and giving each a URL would imply a detail page
 * with more on it than this — the list and the editor are one screen.
 */
export function IcpEditor({
  org,
  icps,
  products,
  canWrite,
}: {
  org: string;
  icps: IcpRecord[];
  products: Product[];
  canWrite: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(icps[0]?.id ?? null);
  /* `creating` is separate from "no selection": one means the user asked for
     a blank form, the other means this org has no ICP yet. Collapsing them
     would make the empty state impossible to word, since it could not tell
     "you have none" from "you are adding one". */
  const [creating, setCreating] = useState(icps.length === 0);

  const selected = creating ? null : (icps.find((i) => i.id === selectedId) ?? icps[0] ?? null);

  return (
    <div className="space-y-6">
      {icps.length > 1 && (
        <Card flush>
          <CardHeader
            title="Your ICPs"
            description="One is active. Everything Huntloop judges is judged against that one."
          />
          <CardBody>
            <ul className="space-y-2">
              {icps.map((icp) => (
                <IcpRow
                  key={icp.id}
                  org={org}
                  icp={icp}
                  selected={!creating && icp.id === selected?.id}
                  canWrite={canWrite}
                  onSelect={() => {
                    setCreating(false);
                    setSelectedId(icp.id);
                  }}
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <IcpForm
        key={creating ? "new" : (selected?.id ?? "none")}
        org={org}
        icp={selected}
        products={products}
        canWrite={canWrite}
        onCancelCreate={icps.length > 0 ? () => setCreating(false) : undefined}
      />

      {canWrite && !creating && (
        <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
          Add another ICP
        </Button>
      )}

      {/* Personas hang off a saved ICP, so they are not offered while one is
          being created — there is no id to attach them to yet, and a form
          that silently discards what you typed is worse than one that waits. */}
      {selected && !creating && (
        <PersonaSection
          org={org}
          icpId={selected.id}
          personas={selected.personas}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

function IcpRow({
  org,
  icp,
  selected,
  canWrite,
  onSelect,
}: {
  org: string;
  icp: IcpRecord;
  selected: boolean;
  canWrite: boolean;
  onSelect: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li
      className={[
        "flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5",
        selected ? "border-brand-border bg-brand-surface" : "border-line bg-surface",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onSelect}
        className="hl-focusable min-w-0 flex-1 text-left"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-fg">{icp.name}</span>
          {icp.isActive && <Badge variant="success">Active</Badge>}
          <span className="text-[12px] text-fg-muted">v{icp.version}</span>
        </span>
      </button>

      {error && <span className="text-[12px] text-danger">{error}</span>}

      {canWrite && !icp.isActive && (
        <Button
          size="sm"
          variant="secondary"
          icon={Check}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await activateIcpAction(org, icp.id);
              if (!res.ok) setError(res.error);
            })
          }
        >
          Make active
        </Button>
      )}

      {canWrite && !icp.isActive && (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          aria-label={`Remove ${icp.name}`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await deleteIcpAction(org, icp.id);
              if (!res.ok) setError(res.error);
            })
          }
        />
      )}
    </li>
  );
}

function IcpForm({
  org,
  icp,
  products,
  canWrite,
  onCancelCreate,
}: {
  org: string;
  icp: IcpRecord | null;
  products: Product[];
  canWrite: boolean;
  onCancelCreate?: () => void;
}) {
  const [name, setName] = useState(icp?.name ?? "");
  const [productId, setProductId] = useState(icp?.productId ?? products[0]?.id ?? "");
  const [segments, setSegments] = useState(joinList(icp?.segments));
  const [sizes, setSizes] = useState(joinList(icp?.sizes));
  const [regions, setRegions] = useState(joinList(icp?.regions));
  const [triggers, setTriggers] = useState(joinList(icp?.triggers));
  const [examples, setExamples] = useState(joinList(icp?.exampleCompanies));
  const [exclusions, setExclusions] = useState(joinList(icp?.exclusions));

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  /* Kept separate from `result`, because a preview is not a save. Sharing the
     banner would let a successful look-up erase the error from a failed save
     — and the message a user most needs to keep on screen is the one saying
     their edit did not persist. */
  const [preview, setPreview] = useState<LookAlikePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();

  function previewExamples() {
    setPreview(null);
    setPreviewError(null);
    startPreview(async () => {
      const res = await previewLookAlikesAction(org, {
        name: name || "Untitled",
        productId: productId.startsWith("demo-") ? "" : productId,
        segments: splitList(segments),
        sizes: splitList(sizes),
        regions: splitList(regions),
        triggers: splitList(triggers),
        exampleCompanies: splitList(examples),
        exclusions: splitList(exclusions),
      });
      if (res.ok) setPreview(res.data);
      else setPreviewError(res.error);
    });
  }

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveIcpAction(org, {
        // A demo id is not a database id. Sending it would fail the uuid
        // check, so an unconfigured deployment's editor behaves as a create.
        id: icp?.id && !icp.id.startsWith("demo-") ? icp.id : undefined,
        name,
        // Same reasoning for the product: demo products have no row to link.
        productId: productId.startsWith("demo-") ? "" : productId,
        segments: splitList(segments),
        sizes: splitList(sizes),
        regions: splitList(regions),
        triggers: splitList(triggers),
        exampleCompanies: splitList(examples),
        exclusions: splitList(exclusions),
      });
      if (res.ok) setResult({ ok: true, message: res.message });
      else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title={icp ? "Ideal customer profile" : "Define your ICP"}
        description="Who is worth hunting. Every score, every why-now and every source recommendation is measured against this."
      />
      <CardBody className="space-y-5">
        {!canWrite && (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
            Your role is read-only. You can see the profile your opportunities
            are judged against, but not change it.
          </p>
        )}

        <Field label="Name" required error={fieldErrors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="Agent infrastructure teams"
            />
          )}
        </Field>

        <Field
          label="Product"
          hint="Which product this profile buys. An ICP can be sketched before the product exists."
          error={fieldErrors.productId}
        >
          {(a) => (
            <Select
              {...a}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!canWrite || pending}
            >
              <option value="">Not tied to a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Segments" hint="One per line." error={fieldErrors.segments}>
          {(a) => (
            <ListInput
              {...a}
              value={segments}
              onChange={(e) => setSegments(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company sizes" hint="One per line." error={fieldErrors.sizes}>
            {(a) => (
              <ListInput
                {...a}
                value={sizes}
                onChange={(e) => setSizes(e.target.value)}
                disabled={!canWrite || pending}
                rows={3}
              />
            )}
          </Field>

          <Field label="Regions" hint="One per line." error={fieldErrors.regions}>
            {(a) => (
              <ListInput
                {...a}
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
                disabled={!canWrite || pending}
                rows={3}
              />
            )}
          </Field>
        </div>

        <Field
          label="Buying triggers"
          hint="Events that mean now is the moment. One per line."
          error={fieldErrors.triggers}
        >
          {(a) => (
            <ListInput
              {...a}
              value={triggers}
              onChange={(e) => setTriggers(e.target.value)}
              disabled={!canWrite || pending}
              rows={4}
            />
          )}
        </Field>

        <Field
          label="Companies that are obviously right"
          hint="Dream accounts or existing customers, as domains — stripe.com, not Stripe. Huntloop reads them and widens the search to match what they have in common."
          error={fieldErrors.exampleCompanies}
        >
          {(a) => (
            <ListInput
              {...a}
              value={examples}
              onChange={(e) => {
                setExamples(e.target.value);
                /* A preview describes the list that produced it. Leaving it up
                   while the list changes underneath is the screen asserting
                   something that is no longer true. */
                setPreview(null);
                setPreviewError(null);
              }}
              disabled={!canWrite || pending}
              rows={3}
              placeholder="stripe.com"
            />
          )}
        </Field>

        {/* ONB-22. The panel under this editor answers the same question from
            the *saved* provider query, which a workspace that has never run
            discovery does not have — so the field that matters most here is
            the one whose effect is least visible. This reads the companies
            now and says what they would add. */}
        {canWrite && (
          <div className="rounded-md border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                onClick={previewExamples}
                disabled={previewing || pending || splitList(examples).length === 0}
              >
                {previewing ? "Reading them…" : "Preview what these add"}
              </Button>
              <span className="text-[12px] text-fg-muted">
                Reads up to five of them. Nothing is saved.
              </span>
            </div>

            {previewError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {previewError}
              </p>
            )}

            {preview && <LookAlikeResult preview={preview} />}
          </div>
        )}

        <Field
          label="Not a fit"
          hint="Its own question, not the opposite of the lists above. A company here stays down the list however strong its trigger."
          error={fieldErrors.exclusions}
        >
          {(a) => (
            <ListInput
              {...a}
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>

        {/* ICP-03. These are stored on the profile, are scored against, and
            have no field on this screen. Until they were preserved on save
            they did not need showing, because a save from here deleted them;
            now that they survive, a criterion that shapes every score and
            appears nowhere in the product is one nobody can account for. */}
        {icp && icp.alsoOnProfile.length > 0 && (
          <div className="rounded-md border border-line-subtle bg-surface px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Also on this profile
            </p>
            <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
              Drafted from your website when the profile was created. This
              screen has no field for them and does not change them when you
              save — they are still scored against.
            </p>
            <ul className="mt-2 space-y-1">
              {icp.alsoOnProfile.map((entry) => (
                <li key={entry.label} className="text-[12px] leading-[1.5] text-fg-muted">
                  <span className="text-fg-secondary">{entry.label}:</span>{" "}
                  {entry.values.slice(0, 6).join(", ")}
                  {entry.values.length > 6 && ` +${entry.values.length - 6}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormMessage result={result} />

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Save} onClick={save} disabled={pending}>
              {pending ? "Saving…" : icp ? "Save changes" : "Create ICP"}
            </Button>
            {onCancelCreate && !icp && (
              <Button variant="ghost" onClick={onCancelCreate} disabled={pending}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Personas ────────────────────────────────────────────────────────────── */

function PersonaSection({
  org,
  icpId,
  personas,
  canWrite,
}: {
  org: string;
  icpId: string;
  personas: Persona[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section>
      <SectionLabel>Personas</SectionLabel>
      <Card className="mt-3">
        <CardHeader
          title="Who you are actually talking to"
          description="Titles and pain points for the people inside a fitting company. Used to pick who an opportunity is routed to."
          actions={
            canWrite && !adding ? (
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                Add persona
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          {personas.length === 0 && !adding && (
            <p className="text-[13px] text-fg-muted">
              No personas yet. Without one, an opportunity says which company is
              worth approaching but not who inside it.
            </p>
          )}

          {personas.map((p) => (
            <PersonaForm
              key={p.id}
              org={org}
              icpId={icpId}
              persona={p}
              canWrite={canWrite}
            />
          ))}

          {adding && (
            <PersonaForm
              org={org}
              icpId={icpId}
              persona={null}
              canWrite={canWrite}
              onDone={() => setAdding(false)}
            />
          )}
        </CardBody>
      </Card>
    </section>
  );
}

function PersonaForm({
  org,
  icpId,
  persona,
  canWrite,
  onDone,
}: {
  org: string;
  icpId: string;
  persona: Persona | null;
  canWrite: boolean;
  onDone?: () => void;
}) {
  const [name, setName] = useState(persona?.name ?? "");
  const [titlePatterns, setTitlePatterns] = useState(joinList(persona?.titlePatterns));
  const [seniority, setSeniority] = useState(joinList(persona?.seniority));
  const [painPoints, setPainPoints] = useState(joinList(persona?.painPoints));

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const isDemo = Boolean(persona?.id?.startsWith("demo-")) || icpId.startsWith("demo-");

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await savePersonaAction(org, {
        id: persona?.id && !isDemo ? persona.id : undefined,
        icpId,
        name,
        titlePatterns: splitList(titlePatterns),
        seniority: splitList(seniority),
        painPoints: splitList(painPoints),
      });
      if (res.ok) {
        setResult({ ok: true, message: res.message });
        onDone?.();
      } else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-line bg-surface px-4 py-4">
      <Field label="Persona" required error={fieldErrors.name}>
        {(a) => (
          <Input
            {...a}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canWrite || pending}
            placeholder="Platform engineering lead"
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Title patterns"
          hint="One per line."
          error={fieldErrors.titlePatterns}
        >
          {(a) => (
            <ListInput
              {...a}
              value={titlePatterns}
              onChange={(e) => setTitlePatterns(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>

        <Field label="Seniority" hint="One per line." error={fieldErrors.seniority}>
          {(a) => (
            <ListInput
              {...a}
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>
      </div>

      <Field
        label="Pain points"
        hint="What this person is trying to fix. One per line."
        error={fieldErrors.painPoints}
      >
        {(a) => (
          <Textarea
            {...a}
            value={painPoints}
            onChange={(e) => setPainPoints(e.target.value)}
            disabled={!canWrite || pending}
            rows={3}
          />
        )}
      </Field>

      <FormMessage result={result} />

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={Save} onClick={save} disabled={pending}>
            {pending ? "Saving…" : persona ? "Save persona" : "Add persona"}
          </Button>
          {persona && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deletePersonaAction(org, persona.id);
                  setResult(
                    res.ok
                      ? { ok: true, message: res.message }
                      : { ok: false, error: res.error },
                  );
                })
              }
            >
              Remove
            </Button>
          )}
          {onDone && !persona && (
            <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
