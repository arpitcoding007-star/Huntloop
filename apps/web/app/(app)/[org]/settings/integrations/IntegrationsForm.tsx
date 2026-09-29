"use client";

import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  Field,
  FormMessage,
  Input,
  Note,
} from "@huntloop/ui";
import { Link2, Unlink } from "lucide-react";
import type { HubspotConnection } from "../../../../../lib/data/integrations";
import { connectHubspotAction, disconnectHubspotAction } from "./actions";

/**
 * The HubSpot connection card.
 *
 * Mirrors `ProductForm`'s shape deliberately — same `useTransition` pattern,
 * same `FormMessage`, same disabled-when-read-only story — because this is
 * the first integration Huntloop ships and the second one should not have to
 * invent its own conventions from nothing.
 */
export function IntegrationsForm({
  org,
  connection,
  canAdmin,
}: {
  org: string;
  connection: HubspotConnection;
  canAdmin: boolean;
}) {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function connect() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await connectHubspotAction(org, token);
      if (res.ok) {
        setResult({ ok: true, message: res.message });
        setToken("");
      } else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  function disconnect() {
    setResult(null);
    start(async () => {
      const res = await disconnectHubspotAction(org);
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });
  }

  return (
    <Card>
      <CardHeader
        title="HubSpot"
        description="Pushes an opportunity's company, primary contact and score out as a HubSpot deal, and reads its stage back as evidence."
        actions={
          canAdmin && connection.connected ? (
            <ConfirmButton
              icon={Unlink}
              label="Disconnect HubSpot"
              confirmLabel="Disconnect it"
              pending={pending}
              onConfirm={disconnect}
            />
          ) : null
        }
      />
      <CardBody className="space-y-5">
        {!canAdmin && (
          <Note>
            Only an owner or an admin can connect or disconnect HubSpot — the
            token this stores reaches your live CRM.
          </Note>
        )}

        {connection.connected ? (
          <div className="space-y-2 text-[13px] text-fg-secondary">
            <p>
              Connected{connection.hubId ? ` — portal ${connection.hubId}` : ""}.
            </p>
            <p>
              {connection.lastSyncedAt
                ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}.`
                : "Not synced yet — use Push to HubSpot on any opportunity."}
            </p>
            {connection.lastSyncError && (
              <p className="text-danger">Last attempt failed: {connection.lastSyncError}</p>
            )}
          </div>
        ) : (
          canAdmin && (
            <>
              <Field
                label="Private app token"
                hint="HubSpot → Settings → Integrations → Private Apps. Needs CRM read/write scopes for companies, contacts and deals."
                error={fieldErrors.token}
              >
                {(a) => (
                  <Input
                    {...a}
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={pending}
                    placeholder="pat-na1-…"
                  />
                )}
              </Field>

              <FormMessage result={result} />

              <div className="flex items-center gap-2">
                <Button variant="primary" icon={Link2} onClick={connect} disabled={pending || !token.trim()}>
                  {pending ? "Connecting…" : "Connect HubSpot"}
                </Button>
              </div>
            </>
          )
        )}

        {connection.connected && <FormMessage result={result} />}
      </CardBody>
    </Card>
  );
}
