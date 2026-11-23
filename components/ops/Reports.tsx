"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Team } from "@/lib/ops/contracts";
import { pretty, timestamp } from "./format";

type Report = {
  reliability: { queued: number; failed: number; processed: number; duplicates: number; accepted: number; p95_seconds: number | null };
  response: { ack_minutes: number | null; resolve_minutes: number | null; escalated: number; overdue: number };
  sources: { name: string; team: string; accepted: number; duplicates: number }[];
  recurring: { service_name: string; category: string; environment: string; cases: number }[];
  failed: { delivery_id: string; source: string; received_at: string; attempts: number; failure_code: string }[];
  followups: { followup_id: string; case_id: string; title: string; case_title: string; due_on: string }[];
  escalated: { case_id: string; title: string; severity: number; ack_due_at: string }[];
  heartbeat: string | null;
};

export default function Reports({ teams, admin }: { teams: Team[]; admin: boolean }) {
  const [team, setTeam] = useState("");
  const [revision, refresh] = useState(0);
  const [data, setData] = useState<Report>();
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState("");
  useEffect(() => {
    let current = true;
    setData(undefined);
    setError("");
    api<Report>(team ? `/api/ops/reports?team=${encodeURIComponent(team)}` : "/api/ops/reports")
      .then((report) => { if (current) setData(report); }).catch((failure) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [team, revision]);

  async function retry(deliveryId: string) {
    setRetrying(deliveryId);
    setError("");
    try {
      await api("/api/ops/reports", { method: "POST", body: { deliveryId } });
      refresh((count) => count + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRetrying("");
    }
  }

  const duration = (n: number | null, unit: string) => n === null ? "—" : `${n.toFixed(1)} ${unit}`;
  return <>
    <section className="ops-card ops-padded">
      <h2>Operations reporting</h2>
      <p className="ops-muted">Thirty-day activity, current delivery backlog, and overdue response work.</p>
      {admin && data && <p className="ops-muted">
        Worker heartbeat {data.heartbeat ? timestamp(data.heartbeat) : "unavailable"}
        {(!data.heartbeat || Date.now() - Date.parse(data.heartbeat) > 30_000) && " · Check worker process"}
      </p>}
      <div className="ops-form">
        <label>Team<select value={team} onChange={(event) => setTeam(event.target.value)}>
          <option value="">All my teams</option>
          {teams.map((item) => <option key={item.team_id} value={item.team_id}>{item.name}</option>)}
        </select></label>
        <button className="ops-button" onClick={() => refresh((count) => count + 1)}>Refresh report</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
    {!data && !error && <p role="status">Loading reports…</p>}
    {data && <>
      <div className="ops-stats">
        {[
          ["Queued deliveries", data.reliability.queued],
          ["Failed deliveries", data.reliability.failed],
          ["Processed in 30 days", data.reliability.processed],
          ["P95 queue-to-case", duration(data.reliability.p95_seconds, "s")],
          ["Deduplicated in 30 days", data.reliability.accepted + data.reliability.duplicates
            ? (100 * data.reliability.duplicates / (data.reliability.accepted + data.reliability.duplicates)).toFixed(1) + "%" : "—"],
          ["Average acknowledgement", duration(data.response.ack_minutes, "min")],
          ["Average resolution", duration(data.response.resolve_minutes, "min")],
          ["Overdue acknowledgements", data.response.overdue],
        ].map(([label, value]) => <div className="ops-card ops-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="ops-profile-grid">
        <section className="ops-card ops-padded"><h2>Escalation queue</h2>
          {data.escalated.length ? <ul className="ops-items">{data.escalated.map((item) => <li key={item.case_id}>
            <div><Link href={`/ops/cases/${item.case_id}`}>{item.title}</Link><small>Due {timestamp(item.ack_due_at)}</small></div>
          </li>)}</ul> : <p className="ops-muted">No acknowledgements overdue.</p>}
        </section>
        <section className="ops-card ops-padded"><h2>Overdue follow-ups</h2>
          {data.followups.length ? <ul className="ops-items">{data.followups.map((item) => <li key={item.followup_id}>
            <div><strong>{item.title}</strong><small><Link href={`/ops/cases/${item.case_id}`}>{item.case_title}</Link> · Due {item.due_on}</small></div>
          </li>)}</ul> : <p className="ops-muted">No follow-ups overdue.</p>}
        </section>
        <section className="ops-card ops-padded"><h2>Alert volume by source</h2>
          {data.sources.length ? <ul className="ops-items">{data.sources.map((item, index) => <li key={index}>
            <div><strong>{item.name}</strong><small>{item.team}</small></div>
            <span>{item.accepted} accepted · {item.duplicates} retries</span>
          </li>)}</ul> : <p className="ops-muted">No recent webhook activity.</p>}
        </section>
        <section className="ops-card ops-padded"><h2>Recurring case patterns</h2>
          {data.recurring.length ? <ul className="ops-items">{data.recurring.map((item) => <li key={`${item.service_name}/${item.category}/${item.environment}`}>
            <div><strong>{item.service_name}</strong><small>{pretty(item.category)} · {item.environment}</small></div>
            <span>{item.cases} cases</span>
          </li>)}</ul> : <p className="ops-muted">No repeated service and category patterns in this period.</p>}
        </section>
      </div>
      <section className="ops-card ops-padded"><h2>Failed deliveries</h2>
        {data.failed.length ? <ul className="ops-items">{data.failed.map((item) => <li key={item.delivery_id}>
          <div><strong>{item.source}</strong><small>{item.failure_code} · {item.attempts} attempts · {timestamp(item.received_at)}</small></div>
          {admin && <button className="ops-button" type="button" onClick={() => retry(item.delivery_id)} disabled={!!retrying}>Retry delivery</button>}
        </li>)}</ul> : <p className="ops-muted">No deliveries need review.</p>}
      </section>
    </>}
  </>;
}
