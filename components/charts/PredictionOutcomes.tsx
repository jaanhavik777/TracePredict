"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Row = {
  version: string; source: string; service: string | null; predictions: number; severity_total: number;
  severity_matches: number; cause_total: number; cause_first: number; cause_top_three: number;
  duration_total: number; duration_mae: number | null;
};
type Health = { scored: number; unavailable: number; errors: number; p95_ms: number | null };

export default function PredictionOutcomes() {
  const [rows, setRows] = useState<Row[]>();
  const [health, setHealth] = useState<Health>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ outcomes: Row[]; health: Health }>("/api/predictions/outcomes").then((data) => {
      setRows(data.outcomes);
      setHealth(data.health);
    })
      .catch(() => setRows(undefined)).finally(() => setLoading(false));
  }, []);
  return <section className="card" style={{ overflowX: "auto" }}>
    <h2>Recorded prediction outcomes</h2>
    <p className="muted">Compares saved intake predictions with engineer-recorded severity and eventual resolution.</p>
    {health && <p className="muted">Past 30 days: {health.scored} scored · {health.unavailable} unavailable · {health.errors} errors
      {health.p95_ms === null ? "" : ` · P95 scoring ${Math.round(health.p95_ms)} ms`}</p>}
    {loading ? <p role="status">Loading outcomes…</p> : !rows ? <p role="alert">Prediction outcomes unavailable.</p> : !rows.length
      ? <p>Save an intake prediction to start tracking outcomes.</p>
      : <table className="table">
        <thead><tr><th>Model and service</th><th>Predictions</th><th>Severity matches</th><th>Cause matches</th><th>Duration error</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.version}/${row.source}/${row.service ?? ""}`}>
          <td>{row.service ?? "All services"} · {row.version} · {row.source}</td>
          <td>{row.predictions}</td><td>{row.severity_matches}/{row.severity_total}</td>
          <td>{row.cause_total ? `${row.cause_first}/${row.cause_total} first choice, ${row.cause_top_three}/${row.cause_total} top three` : "Awaiting labeled outcomes"}</td>
          <td>{row.duration_mae === null ? "Awaiting resolutions" : `${row.duration_mae.toFixed(1)} min MAE (n=${row.duration_total})`}</td>
        </tr>)}</tbody>
      </table>}
  </section>;
}
