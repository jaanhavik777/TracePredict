"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { categories, environments, severityNames, states, type CaseListItem, type Service, type Team } from "@/lib/ops/contracts";
import AuditPanel from "./AuditPanel";
import Settings from "./Settings";
import Reports from "./Reports";
import { pretty, timestamp } from "./format";

type WorkspaceData = {
  teams: Team[]; services: Service[]; cases: CaseListItem[]; admin: boolean;
  stats: { active: number; critical: number; alerts: number; resolved: number };
};

function NewCase({ teams, services }: { teams: Team[]; services: Service[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { caseId } = await api<{ caseId: string }>("/api/ops", {
        method: "POST", body: {
          ...Object.fromEntries(form.entries()), serviceId: Number(form.get("serviceId")), severity: Number(form.get("severity")),
        },
      });
      router.push(`/ops/cases/${caseId}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <details className="ops-card ops-create">
    <summary>Open a case</summary>
    <form onSubmit={submit} className="ops-form">
      <label className="ops-full">Case title<input name="title" required minLength={3} maxLength={160} /></label>
      <label>Team<select name="teamId" required>{teams.map((team) => <option value={team.team_id} key={team.team_id}>{team.name}</option>)}</select></label>
      <label>Service<select name="serviceId" required>{services.map((service) => <option value={service.service_id} key={service.service_id}>{service.service_name}</option>)}</select></label>
      <label>Environment<select name="environment">{environments.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Category<select name="category">{categories.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>
      <label>Severity<select name="severity" defaultValue="2">{severityNames.slice(1).map((value, index) => <option key={value} value={index + 1}>{value}</option>)}</select></label>
      <button className="ops-button ops-primary" disabled={busy}>{busy ? "Opening…" : "Create case"}</button>
      {error && <p className="error ops-full" role="alert">{error}</p>}
    </form>
  </details>;
}

export default function Workspace() {
  const [tab, setTab] = useState<"cases" | "audit" | "settings" | "reports">("cases");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ q: "", teamId: "", status: "" });
  const [revision, reload] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
    setLoading(true);
    setError("");
    api<WorkspaceData>(`/api/ops?${params}`).then((result) => { if (current) setData(result); })
      .catch((failure) => { if (current) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [filters, revision]);

  const auditAccess = data?.teams.some((team) => team.role !== "RESPONDER") || data?.admin;
  return <main className="ops-main">
    <header className="ops-hero">
      <div><p className="ops-kicker">TracePredict / Operations</p><h1>Security operations</h1>
        <p>Investigate grouped alerts, assess service impact, and manage restricted evidence.</p></div>
      <div className="ops-hero-status"><span /> Team-scoped access</div>
    </header>
    <nav className="ops-tabs" aria-label="Security workspace">
      <button aria-pressed={tab === "cases"} onClick={() => setTab("cases")}>Cases & alerts</button>
      <button aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>Reports</button>
      {auditAccess && <button aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Audit log</button>}
      {data?.admin && <button aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>Teams & sources</button>}
    </nav>
    {error && <p className="ops-card ops-padded error" role="alert">{error}</p>}
    {!data && loading && <p role="status">Loading workspace…</p>}
    {data && tab === "cases" && <>
      <section className="ops-stats" aria-label="Case metrics">
        {([["Active cases", "active"], ["Critical active", "critical"], ["Signals received", "alerts"], ["Resolved cases", "resolved"]] as const).map(([label, key]) =>
          <div className="ops-card ops-metric" key={key}><span>{label}</span><strong>{data.stats[key]}</strong></div>
        )}
      </section>
      {data.teams.some((team) => team.role !== "AUDITOR") && data.services.length > 0 &&
        <NewCase teams={data.teams.filter((team) => team.role !== "AUDITOR")} services={data.services} />}
      <section className="ops-card ops-queue">
        <div className="ops-section-title"><div><h2>Case queue</h2><p>Search titles, alert summaries, and evidence summaries.</p></div></div>
        <form className="ops-filters" onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, q: query.trim() }); }}>
          <label>Search cases<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search by keyword or service" /></label>
          <label>Team<select value={filters.teamId} onChange={(event) => setFilters({ ...filters, teamId: event.target.value })}>
            <option value="">All my teams</option>{data.teams.map((team) => <option key={team.team_id} value={team.team_id}>{team.name}</option>)}
          </select></label>
          <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Any status</option>{states.map((value) => <option value={value} key={value}>{pretty(value)}</option>)}
          </select></label>
          <button className="ops-button ops-primary">Search</button>
        </form>
        {loading ? <p className="ops-empty" role="status">Loading cases…</p>
          : data.cases.length ? <div className="ops-scroll"><table className="ops-table">
            <thead><tr><th>Case</th><th>Severity</th><th>Status</th><th>Signals</th><th>Opened</th></tr></thead>
            <tbody>{data.cases.map((item) => <tr key={item.case_id}>
              <td><Link className="ops-case-link" href={`/ops/cases/${item.case_id}`}>{item.title}</Link>
                <small>{item.team_name} · {item.service_name} · {item.environment}</small></td>
              <td><span className={`ops-severity ops-severity-${item.severity}`}>{severityNames[item.severity]}</span></td><td>{pretty(item.status)}</td>
              <td>{item.alert_count}</td><td>{timestamp(item.opened_at)}</td>
            </tr>)}</tbody>
          </table></div>
          : <p className="ops-empty">{data.teams.length ? "No cases match these filters." : "An administrator can add you to a security team."}</p>}
      </section>
    </>}
    {data && auditAccess && tab === "audit" && <AuditPanel teams={data.teams} />}
    {data && tab === "reports" && <Reports teams={data.teams} admin={data.admin} />}
    {data?.admin && tab === "settings" && <Settings teams={data.teams} onChange={() => reload((value) => value + 1)} />}
  </main>;
}
