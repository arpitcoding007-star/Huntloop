"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  SectionLabel,
  Textarea,
} from "@huntloop/ui";
import { AlertTriangle, FileUp, Upload } from "lucide-react";
import {
  COLUMN_ALIASES,
  detectColumns,
  parseCsv,
  type ColumnKey,
  type ParsedCsv,
} from "../../../../lib/csv";
import { normalizeDomain } from "../../../../lib/domain";
import { importCsvAction, type ImportSummary } from "./actions";

/**
 * The CSV importer — master context §59, §60.
 *
 * ── Why there is a preview at all ────────────────────────────────────────
 *
 * Because an import is the one action in this product that writes hundreds of
 * rows from one click, and the failure mode is silent: a file whose domain
 * column is really a marketing URL imports several hundred companies keyed on
 * something that is not a domain, and nothing anywhere says so. §77
 * Principle 7 makes the user the one in control of what enters the hunt, and
 * control means seeing what will happen before it does.
 *
 * So this parses the pasted text *here*, using the same function the server
 * uses, and shows three things a plain upload box cannot: which columns were
 * recognised, which were ignored, and which rows have no usable domain.
 *
 * The text is what gets sent, not the parsed rows — see the note in
 * `actions.ts`. That is what makes the preview a promise rather than a guess.
 */

const MAX_PREVIEW = 8;

export function ImportForm({ org, canWrite }: { org: string; canWrite: boolean }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /* Parsed on every keystroke. It is a pure string function over at most 2 MB
     and it runs in single-digit milliseconds; debouncing it would add state to
     manage for a cost that is not there. */
  const preview: PreviewData | null = useMemo(() => {
    if (!csv.trim()) return null;
    const parsed = parseCsv(csv, 1000);
    const columns = detectColumns(parsed.headers);

    const usable = parsed.rows.filter((r) =>
      columns.domain ? normalizeDomain(r[columns.domain] ?? "") : false,
    );

    return {
      ...parsed,
      columns,
      usable: usable.length,
      unusable: parsed.rows.length - usable.length,
      ignored: parsed.headers.filter((h) => !Object.values(columns).includes(h)),
    };
  }, [csv]);

  function onFile(file: File) {
    // Read here rather than posting the File: the action takes text, and a
    // FormData File would have to be re-read on the server anyway. 2 MB is
    // the bound `csvSchema` enforces; a larger file is refused there with a
    // message rather than truncated silently here.
    file.text().then(setCsv);
  }

  function run() {
    setResult(null);
    setSummary(null);
    start(async () => {
      const res = await importCsvAction(org, csv);
      if (res.ok) {
        setResult({ ok: true, message: res.message });
        setSummary(res.data);
      } else {
        setResult({ ok: false, error: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Import companies"
          description="Paste a CSV or choose a file. Nothing is written until you press Import."
        />
        <CardBody className="space-y-5">
          {!canWrite && (
            <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
              Your role is read-only, so importing is not available to you. An
              admin can change your role under Members.
            </p>
          )}

          <div>
            <label
              htmlFor="csv"
              className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
            >
              CSV
            </label>
            <Textarea
              id="csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              disabled={!canWrite || pending}
              rows={8}
              className="font-mono text-[12px]"
              placeholder={"company,domain,industry,contact name,work email\nAcme,acme.com,AI infrastructure,Dana Whitfield,dana@acme.com"}
            />
            <p className="mt-1.5 text-[12px] text-fg-muted">
              A header row is required. Up to 1,000 rows per import.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
              }}
            />
            <Button
              variant="secondary"
              icon={FileUp}
              disabled={!canWrite || pending}
              onClick={() => fileInput.current?.click()}
            >
              Choose a file
            </Button>
            {csv && (
              <Button variant="ghost" disabled={pending} onClick={() => setCsv("")}>
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {preview && <Preview preview={preview} />}

      {preview && canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={Upload}
            onClick={run}
            disabled={pending || preview.usable === 0}
            /* A disabled control with no reason is the defect NAV-03 exists to
               stop. When there is nothing importable, the button says why
               rather than greying out silently. */
            pending={
              preview.usable === 0
                ? "No row in this file has a usable company domain, so there is nothing to import."
                : undefined
            }
          >
            {pending
              ? "Importing…"
              : `Import ${preview.usable} ${preview.usable === 1 ? "company" : "companies"}`}
          </Button>
        </div>
      )}

      <FormMessage result={result} />
      {summary && <Result summary={summary} />}
    </div>
  );
}

/** What the memo above produces: the parse, plus what it means for the import. */
interface PreviewData extends ParsedCsv {
  columns: Partial<Record<ColumnKey, string>>;
  /** Rows whose domain column yields a real host — the ones that will import. */
  usable: number;
  unusable: number;
  /** Headers no alias matched. Named on screen rather than dropped quietly. */
  ignored: string[];
}

function Preview({ preview }: { preview: PreviewData }) {
  const recognised = Object.entries(preview.columns) as [ColumnKey, string][];

  return (
    <Card flush>
      <CardHeader
        title="What will be imported"
        description="Read from the text above, by the same parser the server will use."
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Figure label="Rows read" value={preview.rows.length} />
          <Figure label="With a usable domain" value={preview.usable} />
          <Figure label="Skipped" value={preview.unusable + preview.malformed} />
        </div>

        {(preview.unusable > 0 || preview.malformed > 0 || preview.truncated) && (
          <div className="flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-surface px-4 py-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warning"
              strokeWidth={1.75}
            />
            <div className="space-y-1">
              {preview.unusable > 0 && (
                <p className="text-[13px] text-warning">
                  {preview.unusable} {preview.unusable === 1 ? "row has" : "rows have"} no
                  usable domain and will be skipped. A domain is what keeps one
                  company one row.
                </p>
              )}
              {preview.malformed > 0 && (
                <p className="text-[13px] text-warning">
                  {preview.malformed}{" "}
                  {preview.malformed === 1 ? "row has" : "rows have"} a different number
                  of columns than the header, so importing them would shift values into
                  the wrong fields.
                </p>
              )}
              {preview.truncated && (
                <p className="text-[13px] text-warning">
                  Only the first 1,000 rows will be imported. Split the file to import
                  the rest.
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <SectionLabel>Columns recognised</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recognised.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                None. Name a column {Object.keys(COLUMN_ALIASES).slice(0, 2).join(" and ")}.
              </p>
            ) : (
              recognised.map(([key, header]) => (
                <Badge key={key} variant="success">
                  {header} → {key}
                </Badge>
              ))
            )}
          </div>

          {preview.ignored.length > 0 && (
            <>
              {/* Named rather than dropped quietly: a column the importer did
                  not understand is data the user thinks they imported. */}
              <p className="mt-3 text-[12px] text-fg-muted">
                Not recognised, and not imported:{" "}
                <span className="text-fg-secondary">{preview.ignored.join(", ")}</span>
              </p>
            </>
          )}
        </div>

        {preview.rows.length > 0 && (
          <div>
            <SectionLabel>First rows</SectionLabel>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line-subtle">
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        className="px-2 py-1.5 text-left font-medium text-fg-muted uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, MAX_PREVIEW).map((row, i) => (
                    <tr key={i} className="border-b border-line-subtle last:border-0">
                      {preview.headers.map((h) => (
                        <td key={h} className="truncate px-2 py-1.5 text-fg-secondary">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Result({ summary }: { summary: ImportSummary }) {
  return (
    <Card>
      <CardHeader
        title="What happened"
        /* An importer that reports "300 imported" when 300 already existed has
           told the user nothing. These are separate numbers for that reason. */
        description="Existing companies were left as they were — an import does not overwrite what research found."
      />
      <CardBody>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Figure label="Companies added" value={summary.companiesAdded} />
          <Figure label="Already on your list" value={summary.companiesAlreadyPresent} />
          <Figure label="People added" value={summary.peopleAdded} />
          <Figure label="Email addresses" value={summary.emailsAdded} />
          {summary.unusable > 0 && <Figure label="Skipped" value={summary.unusable} />}
        </div>
      </CardBody>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value.toLocaleString()}</p>
    </div>
  );
}
