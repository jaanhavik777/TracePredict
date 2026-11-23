import { NextRequest, NextResponse } from "next/server";
import { handleError, requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const rows = await query(
      `WITH observed AS (
        SELECT p.result->>'version' AS version, p.result->>'source' AS source,
           coalesce(s.service_name, 'Unassigned service') AS service,
           p.result->>'severity' AS predicted_severity, sev.severity_name AS actual_severity,
           p.result->'causes' AS causes, r.root_cause_category AS actual_cause,
           CASE WHEN r.resolved_at >= i.created_at AND jsonb_typeof(p.result->'minutes') = 'number'
             THEN abs((p.result->>'minutes')::float - extract(epoch FROM r.resolved_at - i.created_at)/60) END AS duration_error
        FROM incident_predictions p JOIN incidents i USING (incident_id)
        JOIN incident_severities sev USING (severity_id)
        LEFT JOIN incident_services ins ON ins.incident_id = i.incident_id AND ins.is_primary
        LEFT JOIN services s USING (service_id)
        LEFT JOIN resolutions r ON r.incident_id = i.incident_id
      )
      SELECT version, source, service, count(*)::int AS predictions,
        count(predicted_severity)::int AS severity_total,
        count(*) FILTER (WHERE predicted_severity = actual_severity)::int AS severity_matches,
        count(*) FILTER (WHERE actual_cause IS NOT NULL AND jsonb_array_length(causes) > 0)::int AS cause_total,
        count(*) FILTER (WHERE causes->>0 = actual_cause)::int AS cause_first,
        count(*) FILTER (WHERE causes ? actual_cause)::int AS cause_top_three,
        count(duration_error)::int AS duration_total, avg(duration_error)::float AS duration_mae
      FROM observed GROUP BY GROUPING SETS ((version, source, service), (version, source))
      ORDER BY version, service NULLS FIRST`,
    );
    const [health] = await query(
      `SELECT count(*) FILTER (WHERE outcome = 'SCORED')::int AS scored,
              count(*) FILTER (WHERE outcome = 'UNAVAILABLE')::int AS unavailable,
              count(*) FILTER (WHERE outcome = 'ERROR')::int AS errors,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms) FILTER (WHERE outcome = 'SCORED') AS p95_ms
       FROM ops.prediction_health WHERE observed_at >= now() - INTERVAL '30 days'`,
    );
    return NextResponse.json({ outcomes: rows, health }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
