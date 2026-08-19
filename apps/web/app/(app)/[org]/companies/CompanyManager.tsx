"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  FormMessage,
  Input,
  PriorityBadge,
  Textarea,
  type Column,
} from "@huntloop/ui";
import { Building2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { Company } from "../../../../lib/data/company";
import { deleteCompanyAction, saveCompanyAction } from "./actions";

/**
 * Companies — master context §12.
 *
 * The account record behind an opportunity, and the only screen where one can
 * be created by hand. §12 splits a company's problems, gaps and triggers into
 * their own tables; none of them are edited here, because they are *findings*
 * — things Huntloop observed with evidence behind them — and a text box that
 * let a user type a problem straight into the record would produce rows
 * indistinguishable from researched ones. §7 is the whole argument for the
 * evidence table, and it applies to this form.
 *
 * So this edits the identifying facts only: who the company is, where, how
 * big. Everything judgemental arrives through research.
 */
export function CompanyManager({
  org,
  companies,
  canWrite,
}: {
  org: string;
  companies: Company[];
  canWrite: boolean;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("name");
  /** `null` = not editing. `"new"` = the blank form. Otherwise a company id. */
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      (scope === "name"
        ? c.name
        : scope === "domain"
          ? c.canonicalDomain
          : (c.industry ?? "")
      )
        .toLowerCase()
        .includes(q),
    );
  }, [companies, query, scope]);

  const columns: Column<Company>[] = [
    {
      key: "name",
      header: "Company",
      render: (c) => (
        <div className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-fg">{c.name}</span>
          <span className="block truncate font-mono text-[12px] text-fg-muted">
            {c.canonicalDomain}
          </span>
        </div>
      ),
    },
    {
      key: "industry",
      header: "Industry",
      width: "200px",
      /* An unresearched field is UNKNOWN, not blank. §78's rule about scores
         is the same rule here: a blank cell reads as "there is nothing", and
         "we have not looked" is a different statement. */
      render: (c) => <Unknown value={c.industry} />,
    },
    {
      key: "size",
      header: "People",
      width: "110px",
      align: "right",
      render: (c) => (
        <Unknown value={c.employeeCount === null ? null : c.employeeCount.toLocaleString()} />
      ),
    },
    {
      key: "region",
      header: "Region",
      width: "160px",
      render: (c) => <Unknown value={c.region ?? c.country} />,
    },
    {
      key: "opportunities",
      header: "Opportunities",
      width: "190px",
      render: (c) =>
        c.opportunityCount === 0 ? (
          <span className="text-[12px] text-fg-muted">None yet</span>
        ) : (
          <span className="flex items-center gap-2">
            {c.topPriority && <PriorityBadge priority={c.topPriority} reason={priorityReason(c)} />}
            {/* A real destination: the list seeds its company search from
                `?company=`. Without that this number would be inert text or,
                worse, a link to an unfiltered list. */}
            <Link
              href={`/${org}/opportunities?company=${encodeURIComponent(c.name)}`}
              className="hl-focusable text-[12px] text-brand underline-offset-2 hover:underline"
            >
              {c.opportunityCount} open
            </Link>
          </span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "90px",
      align: "right",
      render: (c) =>
        canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Pencil}
            aria-label={`Edit ${c.name}`}
            onClick={() => setEditing(editing === c.id ? null : c.id)}
          />
        ) : null,
    },
  ];

  const editingCompany =
    editing && editing !== "new" ? (companies.find((c) => c.id === editing) ?? null) : null;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-9 font-semibold text-fg">Companies</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {org} · {companies.length} {companies.length === 1 ? "company" : "companies"} ·
            the accounts your opportunities are about
          </p>
        </div>
        {canWrite && (
          <Button
            icon={Plus}
            variant="primary"
            onClick={() => setEditing(editing === "new" ? null : "new")}
          >
            Add a company
          </Button>
        )}
      </header>

      {(editing === "new" || editingCompany) && (
        <div className="mt-6">
          <CompanyForm
            key={editing}
            org={org}
            company={editingCompany}
            canWrite={canWrite}
            onDone={() => setEditing(null)}
          />
        </div>
      )}

      <div className="mt-6">
        <FilterBar
          placeholder="Search companies"
          value={query}
          onChange={setQuery}
          scopes={[
            { value: "name", label: "Name" },
            { value: "domain", label: "Domain" },
            { value: "industry", label: "Industry" },
          ]}
          scope={scope}
          onScopeChange={setScope}
        />
      </div>

      <div className="mt-4">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          empty={
            <EmptyState
              icon={Building2}
              title={query ? "No company matches that" : "No companies yet"}
              description={
                query
                  ? "Nothing here matches your search. Clear it to see the whole list."
                  : "Companies arrive from a hunt, from Analyze a URL, or from an import. You can also add one by hand."
              }
            />
          }
        />
      </div>
    </div>
  );
}

/**
 * "Unknown", rather than an empty cell.
 *
 * §78 forbids a 0 standing in for an unmeasured score, and the same
 * distinction applies to a text field: blank reads as "there is nothing here",
 * which is a finding. Not having looked is not a finding.
 */
function Unknown({ value }: { value: string | null }) {
  return value ? (
    <span className="text-[13px] text-fg-secondary">{value}</span>
  ) : (
    <span className="text-[12px] text-fg-muted uppercase">Unknown</span>
  );
}

function priorityReason(c: Company): string {
  return `The strongest verdict among this company's ${c.opportunityCount} open ${
    c.opportunityCount === 1 ? "opportunity" : "opportunities"
  }. Open the list to see the reasoning behind it.`;
}

function CompanyForm({
  org,
  company,
  canWrite,
  onDone,
}: {
  org: string;
  company: Company | null;
  canWrite: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(company?.name ?? "");
  const [domain, setDomain] = useState(company?.canonicalDomain ?? "");
  const [website, setWebsite] = useState(company?.website ?? "");
  const [industry, setIndustry] = useState(company?.industry ?? "");
  const [country, setCountry] = useState(company?.country ?? "");
  const [region, setRegion] = useState(company?.region ?? "");
  const [employees, setEmployees] = useState(
    company?.employeeCount === null || company?.employeeCount === undefined
      ? ""
      : String(company.employeeCount),
  );
  const [businessModel, setBusinessModel] = useState(company?.businessModel ?? "");
  const [description, setDescription] = useState(company?.description ?? "");

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const isDemo = Boolean(company?.id.startsWith("demo-"));

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveCompanyAction(org, {
        id: company && !isDemo ? company.id : undefined,
        name,
        domain,
        website,
        industry,
        country,
        region,
        businessModel,
        description,
        /* An empty box is "not known", which is NULL — not 0. A 0 here would
           assert a company with no employees, which is a finding nobody made.
           `Number("")` is 0, so the empty case is handled before parsing. */
        employeeCount: employees.trim() === "" ? null : Number(employees),
      });
      if (res.ok) {
        setResult({ ok: true, message: res.message });
        onDone();
      } else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title={company ? `Edit ${company.name}` : "Add a company"}
        description="Identifying facts only. Problems, gaps and triggers arrive from research, with evidence behind them."
        actions={
          company && canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteCompanyAction(org, company.id);
                  if (res.ok) onDone();
                  else setResult({ ok: false, error: res.error });
                })
              }
            >
              Remove
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" required error={fieldErrors.name}>
            {(a) => (
              <Input
                {...a}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="Acme"
              />
            )}
          </Field>

          <Field
            label="Domain"
            required
            hint="The company's own domain. Paste a URL if that is easier — it is reduced to the host."
            error={fieldErrors.domain}
          >
            {(a) => (
              <Input
                {...a}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="acme.com"
              />
            )}
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Website" error={fieldErrors.website}>
            {(a) => (
              <Input
                {...a}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="https://acme.com"
              />
            )}
          </Field>

          <Field label="Industry" error={fieldErrors.industry}>
            {(a) => (
              <Input
                {...a}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="AI infrastructure"
              />
            )}
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Country" error={fieldErrors.country}>
            {(a) => (
              <Input
                {...a}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="US"
              />
            )}
          </Field>

          <Field label="Region" error={fieldErrors.region}>
            {(a) => (
              <Input
                {...a}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="San Francisco, CA"
              />
            )}
          </Field>

          <Field
            label="People"
            hint="Leave blank if unknown."
            error={fieldErrors.employeeCount}
          >
            {(a) => (
              <Input
                {...a}
                type="number"
                min={0}
                value={employees}
                onChange={(e) => setEmployees(e.target.value)}
                disabled={!canWrite || pending}
                placeholder=""
              />
            )}
          </Field>
        </div>

        <Field label="Business model" error={fieldErrors.businessModel}>
          {(a) => (
            <Input
              {...a}
              value={businessModel}
              onChange={(e) => setBusinessModel(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="B2B SaaS"
            />
          )}
        </Field>

        <Field
          label="What they do"
          hint="Plain description. Not a judgement about whether they are a fit."
          error={fieldErrors.description}
        >
          {(a) => (
            <Textarea
              {...a}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>

        <FormMessage result={result} />

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Save} onClick={save} disabled={pending}>
              {pending ? "Saving…" : company ? "Save changes" : "Add company"}
            </Button>
            <Button variant="ghost" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
