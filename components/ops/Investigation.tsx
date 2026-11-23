"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api-client";
import { severityNames, type Evidence, type SecurityCase, type Signal, type TeamRole } from "@/lib/ops/contracts";
import type { DeploymentSignal, ImpactNode } from "@/lib/ops/impact";
import ImpactMap from "./ImpactMap";
import ResponsePlan from "./ResponsePlan";
import type { Coordination } from "@/lib/ops/coordination";
import { pretty, timestamp } from "./format";

type CaseReport = {
  case: SecurityCase; role: TeamRole; evidence: Evidence[]; signals: Signal[];
  impact: { nodes: ImpactNode[]; deployments: DeploymentSignal[] }; coordination: Coordination;
};

export default function Investigation({ id }: { id: string }) {
  const endpoint = `/api/ops/cases/${encodeURIComponent(id)}`;
  const [report, setReport] = useState<CaseReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restricted, setRestricted] = useState<{ id: string; detail: string } | null>(null);
  const load = useCallback(async () => {
    setReport(await api<CaseReport>(endpoint));
  }, [endpoint]);
  useEffect(() => { load().catch((failure) => setError(failure.message)); }, [load]);

  async function update(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void update(async () => {
      await api(endpoint + "/evidence", { method: "POST", body: {
        summary: values.get("summary"),
        ...(String(values.get("restricted") ?? "").trim() ? { restricted: values.get("restricted") } : {}),
      } });
      form.reset();
    });
  }
  async function reveal(id: string) {
    setError("");
    setRestricted(null);
    setBusy(true);
    try {
      const result = await api<{ detail: string }>(endpoint + "/evidence?id=" + encodeURIComponent(id));
      setRestricted({ id, detail: result.detail });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!report) return <main className="ops-main"><Link className="ops-back" href="/ops">← Case queue</Link>
    {error ? <p role="alert" className="ops-card ops-padded error">{error}</p> : <p role="status">Loading case…</p>}
  </main>;
  const record = report.case;
  const sensitive = report.role === "LEAD" || report.role === "ADMIN";
  const editable = record.status !== "RESOLVED" && report.role !== "AUDITOR";

  return <main className="ops-main">
    <Link className="ops-back" href="/ops">← Case queue</Link>
    <header className="ops-hero ops-case-hero">
      <div>
        <p className="ops-kicker">{record.team_name} / {pretty(record.category)}</p>
        <h1>{record.title}</h1>
        <p>{record.service_name} · {record.environment} · Opened {timestamp(record.opened_at)}</p>
      </div>
      <div className="ops-case-status">
        <span className={`ops-severity ops-severity-${record.severity}`}>{severityNames[record.severity]}</span>
        <span>{pretty(record.status)}</span>
      </div>
    </header>
    <div className="ops-actionbar">
      {editable && record.status === "OPEN" && <button className="ops-button ops-primary" disabled={busy}
        onClick={() => update(() => api(endpoint, { method: "PATCH", body: { status: "INVESTIGATING" } }))}>Start investigation</button>}
      {sensitive && <a className="ops-button" href={`${endpoint}?format=json`}>Download redacted case</a>}
    </div>
    {error && <p role="alert" className="ops-card ops-padded error">{error}</p>}
    {record.resolution && <section className="ops-card ops-padded"><h2>Resolution</h2><p>{record.resolution}</p>
      {record.resolved_at && <small className="ops-muted">Resolved {timestamp(record.resolved_at)}</small>}</section>}
    <ImpactMap {...report.impact} />
    <ResponsePlan record={record} response={report.coordination} canWrite={report.role !== "AUDITOR"} busy={busy}
      postmortem={sensitive ? endpoint + "?format=postmortem" : undefined}
      submit={(body) => void update(() => api(endpoint + "/coordination", { method: "POST", body }))} />
    <div className="ops-profile-grid">
      <section className="ops-card ops-padded"><h2>Alert timeline</h2>
        <p className="ops-muted">Alerts group by team, service, environment, and category within 15 minutes of the previous signal.</p>
        {report.signals.length ? <ol className="ops-items">{report.signals.map((signal) => <li key={signal.alert_id}>
          <div><strong>{signal.title}</strong><p>{signal.message}</p><small>{timestamp(signal.occurred_at)}</small></div>
          <span className={`ops-severity ops-severity-${signal.severity}`}>{severityNames[signal.severity]}</span>
        </li>)}</ol> : <p className="ops-muted">No incoming alerts are linked to this case.</p>}
      </section>
      <section className="ops-card ops-padded"><h2>Evidence</h2>
        {!!report.evidence.length && <ul className="ops-items">{report.evidence.map((item) => <li key={item.evidence_id}>
          <div>
            <strong>{item.summary}</strong><small>{timestamp(item.recorded_at)}</small>
            {item.has_restricted && <small>Restricted detail available to team leads</small>}
            {restricted?.id === item.evidence_id && <pre className="ops-restricted">{restricted.detail}</pre>}
          </div>
          {sensitive && item.has_restricted && <button type="button" className="ops-button" disabled={busy} onClick={() =>
            restricted?.id === item.evidence_id ? setRestricted(null) : void reveal(item.evidence_id)}>
            {restricted?.id === item.evidence_id ? "Hide detail" : "View restricted detail"}
          </button>}
        </li>)}</ul>}
        {!report.evidence.length && <p className="ops-muted">No evidence has been recorded.</p>}
        {editable && <form onSubmit={addEvidence} className="ops-form">
          <label className="ops-full">Shared summary<textarea name="summary" required minLength={3} maxLength={600} rows={3} /></label>
          <label className="ops-full">Restricted detail <small>(optional)</small><textarea name="restricted" maxLength={4000} rows={2} /></label>
          <button disabled={busy} className="ops-button ops-primary">Add evidence</button>
        </form>}
      </section>
    </div>
    {editable && record.status === "INVESTIGATING" && <section className="ops-card ops-padded"><h2>Resolve case</h2>
      <form className="ops-form" onSubmit={(event) => {
        event.preventDefault();
        const resolution = new FormData(event.currentTarget).get("resolution");
        void update(() => api(endpoint, { method: "PATCH", body: { status: "RESOLVED", resolution } }));
      }}>
        <label className="ops-full">Resolution summary<textarea name="resolution" required minLength={10} maxLength={2000} rows={3} /></label>
        <button className="ops-button ops-primary" disabled={busy}>Mark resolved</button>
      </form>
    </section>}
  </main>;
}
