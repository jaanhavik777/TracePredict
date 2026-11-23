import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { rowSchema, timeFeatures } from "./contracts";

async function main() {
  loadEnvConfig(process.cwd());
  const { query, pool } = await import("../lib/db");
  try {
    const records = await query<{
      created_at: Date; resolved_at: Date | null; text: string; severity: string;
      cause: string | null; minutes: number | null; affected_services: number;
      recent_incidents: number; recent_deployments: number; prior_resolution_minutes: number | null;
      intake_snapshot: unknown;
    }>(`
      SELECT i.created_at, r.resolved_at, i.title || ' ' || i.description AS text,
        v.severity_name AS severity, r.root_cause_category AS cause,
        (EXTRACT(EPOCH FROM (r.resolved_at - i.created_at)) / 60)::FLOAT8 AS minutes,
        (SELECT COUNT(*)::INT FROM incident_services s WHERE s.incident_id = i.incident_id) AS affected_services,
        c.*, p0.features AS intake_snapshot
      FROM incidents i
      JOIN incident_severities v USING (severity_id)
      JOIN incident_services p ON p.incident_id = i.incident_id AND p.is_primary
      LEFT JOIN resolutions r ON r.incident_id = i.incident_id
      LEFT JOIN incident_predictions p0 ON p0.incident_id = i.incident_id
      CROSS JOIN LATERAL prediction_context(p.service_id, i.created_at) c
      ORDER BY i.created_at, i.incident_id
    `);
    const rows = records.map((r) => rowSchema.parse({
      createdAt: r.created_at.toISOString(), resolvedAt: r.resolved_at?.toISOString() ?? null,
      severity: r.severity, cause: r.cause, minutes: r.minutes,
      features: r.intake_snapshot ?? {
        text: r.text, affectedServices: r.affected_services, recentIncidents: r.recent_incidents,
        recentDeployments: r.recent_deployments, priorResolutionMinutes: r.prior_resolution_minutes,
        ...timeFeatures(r.created_at),
      },
    }));
    const target = process.argv[2] ?? ".models/training.json";
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(rows, null, 2));
    console.log(`Exported ${rows.length} incidents, ${rows.filter((row) => row.resolvedAt).length} resolved, to ${target}`);
    for (const key of ["severity", "cause"] as const) {
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const label = row[key] ?? "missing";
        counts[label] = (counts[label] ?? 0) + 1;
      }
      console.table(counts);
    }
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
