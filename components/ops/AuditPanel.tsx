"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Audit, Team } from "@/lib/ops/contracts";
import { pretty, timestamp } from "./format";

export default function AuditPanel({ teams }: { teams: Team[] }) {
  const [team, setTeam] = useState("");
  const [action, setAction] = useState("");
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<Audit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setRows(null);
    setError("");
    const query = new URLSearchParams({ ...(team ? { team } : {}), action: filter });
    api<{ audit: Audit[] }>(`/api/ops/audit?${query}`)
      .then((data) => { if (current) setRows(data.audit); })
      .catch((failure) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [team, filter]);
  return <section className="ops-card ops-queue">
    <div className="ops-section-title"><div><h2>Audit log</h2><p>Case activity, evidence access, exports, and permission changes.</p></div></div>
    <form className="ops-filters" onSubmit={(event) => { event.preventDefault(); setFilter(action.trim()); }}>
      <label>Action<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. EXPORT" maxLength={60} /></label>
      <label>Team<select value={team} onChange={(event) => setTeam(event.target.value)}>
        <option value="">All visible activity</option>
        {teams.filter((item) => item.role !== "RESPONDER").map((item) => <option value={item.team_id} key={item.team_id}>{item.name}</option>)}
      </select></label>
      <button className="ops-button">Filter</button>
    </form>
    {error ? <p role="alert" className="ops-empty error">{error}</p>
      : !rows ? <p role="status" className="ops-empty">Loading activity…</p>
      : !rows.length ? <p className="ops-empty">No matching activity.</p> : <div className="ops-scroll"><table className="ops-table">
        <thead><tr><th>Action</th><th>Team</th><th>Actor</th><th>Target</th><th>When</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.audit_id}>
          <td><strong>{pretty(row.action)}</strong></td>
          <td>{teams.find((item) => item.team_id === row.team_id)?.name ?? "System"}</td>
          <td>{row.actor_id === null ? "Automation" : `User #${row.actor_id}`}</td>
          <td>{row.subject_user_id ? `User #${row.subject_user_id} · ${pretty(row.membership_role ?? "")}`
            : row.target ? <code title={row.target}>{row.target.slice(0, 8)}</code> : "—"}</td>
          <td>{timestamp(row.recorded_at)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
