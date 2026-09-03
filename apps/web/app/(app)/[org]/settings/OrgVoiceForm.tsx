"use client";

import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Input,
  ListInput,
  Select,
  joinList,
  splitList,
} from "@huntloop/ui";
import { Save } from "lucide-react";
import { ORG_TONES, type OrgProfile, type OrgTone } from "@huntloop/db/org-profile";
import { saveOrgProfileAction } from "./actions";

/**
 * How outreach sounds, and how much unworked backlog is allowed.
 *
 * Two unrelated things on one card because they are the two settings that
 * belong to the organisation rather than to a product, an ICP or a source —
 * and a settings section with a card per field reads as unfinished.
 *
 * ── Why tone is a dropdown ───────────────────────────────────────────────
 *
 * Because it is rendered into a prompt as an instruction, and a free-text
 * field there is an injection surface on something an admin fills in. It is
 * also not a real expressive loss: anything more specific than five tones
 * belongs in Memory, which is the freeform house-style store and is read into
 * the same guidance list — after this, so a sentence somebody wrote
 * deliberately always beats a dropdown.
 *
 * ── Why the backlog cap is here and not hidden ───────────────────────────
 *
 * It is the one setting that can make the product appear to stop working. An
 * org that hits it sees discovery pause, and if the number were only in the
 * database the explanation would live nowhere a customer could reach. The
 * field states the default and states what zero means.
 */
const TONE_LABEL: Record<OrgTone, string> = {
  direct: "Direct — get to the point in the first sentence",
  warm: "Warm — interested, without flattery",
  formal: "Formal — full sentences, no contractions",
  technical: "Technical — concrete about mechanism, no marketing",
  plain: "Plain — no jargon, nothing that needs explaining",
};

export function OrgVoiceForm({
  org,
  profile,
  canAdmin,
}: {
  org: string;
  profile: OrgProfile;
  canAdmin: boolean;
}) {
  const [tone, setTone] = useState<OrgTone | "">(profile.voice.tone ?? "");
  const [competitors, setCompetitors] = useState(joinList(profile.voice.competitors));
  const [regions, setRegions] = useState(joinList(profile.voice.targetRegions));
  const [backlogCap, setBacklogCap] = useState(
    profile.engine.backlogCap === null ? "" : String(profile.engine.backlogCap),
  );

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveOrgProfileAction(org, {
        tone: tone || null,
        competitors: splitList(competitors),
        targetRegions: splitList(regions),
        // Empty means "not set", which resolves to the default. Distinct from
        // 0, which means unlimited — see `backlog_cap()` in `0010`.
        backlogCap: backlogCap.trim() === "" ? null : Number(backlogCap),
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
        title="Voice and limits"
        description="How outreach sounds, who you compete with, and how much unworked pipeline Huntloop is allowed to build up."
      />
      <CardBody className="space-y-5">
        {!canAdmin && (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
            Only an owner or an admin can change these. You can see them.
          </p>
        )}

        <Field
          label="Tone"
          hint="Applied to every message Huntloop drafts. Anything more specific belongs in Memory, which overrides this."
          error={fieldErrors.tone}
        >
          {(a) => (
            <Select
              {...a}
              value={tone}
              onChange={(e) => setTone(e.target.value as OrgTone | "")}
              disabled={!canAdmin || pending}
            >
              <option value="">No preference</option>
              {ORG_TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Competitors"
          hint="One per line. Given as context so a message does not claim to beat one without evidence — not a list of words to avoid."
          error={fieldErrors.competitors}
        >
          {(a) => (
            <ListInput
              {...a}
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              disabled={!canAdmin || pending}
              rows={3}
              placeholder={"Acme\nInitech"}
            />
          )}
        </Field>

        <Field
          label="Where you sell"
          hint="One per line. Used for spelling and date conventions, not as a filter — who you sell to is the ICP's job."
          error={fieldErrors.targetRegions}
        >
          {(a) => (
            <ListInput
              {...a}
              value={regions}
              onChange={(e) => setRegions(e.target.value)}
              disabled={!canAdmin || pending}
              rows={3}
              placeholder={"North America\nEurope"}
            />
          )}
        </Field>

        <Field
          label="Backlog limit"
          hint="Discovery pauses once this many opportunities are waiting and nobody has looked at them. Leave empty for the default of 250; set 0 for no limit."
          error={fieldErrors.backlogCap}
        >
          {(a) => (
            <Input
              {...a}
              type="number"
              min={0}
              value={backlogCap}
              onChange={(e) => setBacklogCap(e.target.value)}
              disabled={!canAdmin || pending}
              placeholder="250"
            />
          )}
        </Field>

        <FormMessage result={result} />

        {canAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Save} onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
