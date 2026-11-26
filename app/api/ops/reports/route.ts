import { NextRequest, NextResponse } from "next/server";
import { AuthError, HttpError, handleError } from "@/lib/auth";
import { actor, audit, jsonBody, resourceId, teamRole, workspace } from "@/lib/ops/access";
import { query, withTransaction } from "@/lib/db";
import { maintainInlineQueue, processInlineDelivery, usesInlineWorker } from "@/lib/ops/inline-worker";

export async function GET(req: NextRequest) {
  try {
    const user = await actor(req);
    const selection = req.nextUrl.searchParams.get("team");
    const team = selection ? resourceId(selection) : null;
    await maintainInlineQueue();
    const result = await workspace(user.id, async (client) => {
      if (team) await teamRole(client, team);
      const { rows: [reliability] } = await client.query(
        `SELECT count(*) FILTER (WHERE status = 'QUEUED')::int AS queued,
           count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           count(*) FILTER (WHERE status = 'PROCESSED' AND received_at >= now() - INTERVAL '30 days')::int AS processed,
           coalesce(sum(duplicate_count) FILTER (WHERE received_at >= now() - INTERVAL '30 days'), 0)::int AS duplicates,
           count(*) FILTER (WHERE received_at >= now() - INTERVAL '30 days')::int AS accepted,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at - received_at))
             FILTER (WHERE processed_at IS NOT NULL AND received_at >= now() - INTERVAL '30 days') AS p95_seconds
         FROM ops.deliveries WHERE ($1::uuid IS NULL OR team_id = $1)`, [team],
      );
      const { rows: [response] } = await client.query(
        `SELECT count(*) FILTER (WHERE status <> 'RESOLVED' AND escalated_at IS NOT NULL AND acknowledged_at IS NULL)::int AS escalated,
           count(*) FILTER (WHERE status <> 'RESOLVED' AND acknowledged_at IS NULL AND ack_due_at < now())::int AS overdue,
           avg(extract(epoch FROM acknowledged_at - opened_at)/60) FILTER (WHERE opened_at >= now() - INTERVAL '30 days')::float AS ack_minutes,
           avg(extract(epoch FROM resolved_at - opened_at)/60) FILTER (WHERE opened_at >= now() - INTERVAL '30 days')::float AS resolve_minutes
         FROM ops.cases WHERE ($1::uuid IS NULL OR team_id = $1)`, [team],
      );
      const { rows: sources } = await client.query(
        `SELECT s.name, t.name AS team, count(*)::int AS accepted, sum(d.duplicate_count)::int AS duplicates
         FROM ops.deliveries d JOIN ops.sources s USING (source_id, team_id) JOIN ops.teams t USING (team_id)
         WHERE ($1::uuid IS NULL OR d.team_id = $1) AND d.received_at >= now() - INTERVAL '30 days'
         GROUP BY s.source_id, s.name, t.name ORDER BY count(*) + sum(d.duplicate_count) DESC LIMIT 10`, [team],
      );
      const { rows: recurring } = await client.query(
        `SELECT coalesce(ts.name, s.service_name) AS service_name, c.category, c.environment, count(*)::int AS cases
         FROM ops.cases c JOIN services s USING (service_id)
         LEFT JOIN ops.team_services ts ON ts.team_id = c.team_id AND ts.service_id = c.service_id
         WHERE ($1::uuid IS NULL OR c.team_id = $1) AND c.opened_at >= now() - INTERVAL '30 days'
         GROUP BY s.service_id, s.service_name, ts.name, c.category, c.environment HAVING count(*) > 1
         ORDER BY count(*) DESC LIMIT 10`, [team],
      );
      const { rows: failed } = await client.query(
        `SELECT d.delivery_id, s.name AS source, d.received_at, d.attempts, d.failure_code
         FROM ops.deliveries d JOIN ops.sources s USING (source_id, team_id)
         WHERE ($1::uuid IS NULL OR d.team_id = $1) AND d.status = 'FAILED'
         ORDER BY d.received_at DESC LIMIT 25`, [team],
      );
      const { rows: followups } = await client.query(
        `SELECT f.followup_id, f.case_id, f.title, f.owner_id, to_char(f.due_on, 'YYYY-MM-DD') AS due_on, c.title AS case_title
         FROM ops.followups f JOIN ops.cases c USING (case_id, team_id)
         WHERE ($1::uuid IS NULL OR f.team_id = $1) AND f.done_at IS NULL AND f.due_on < CURRENT_DATE
         ORDER BY f.due_on LIMIT 25`, [team],
      );
      const { rows: escalated } = await client.query(
        `SELECT case_id, title, severity, ack_due_at FROM ops.cases
         WHERE ($1::uuid IS NULL OR team_id = $1) AND status <> 'RESOLVED'
           AND acknowledged_at IS NULL AND ack_due_at < now()
         ORDER BY severity DESC, ack_due_at LIMIT 25`, [team],
      );
      return { reliability, response, sources, recurring, failed, followups, escalated };
    });
    const heartbeat = user.admin
      ? (await query("SELECT last_seen_at FROM ops.worker_health WHERE worker = 'operations'"))[0]?.last_seen_at ?? null
      : null;
    return NextResponse.json({ ...result, heartbeat, workerMode: usesInlineWorker() ? "inline" : "background" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await actor(req);
    if (!user.admin) throw new AuthError(403, "Administrator access required");
    const body = await jsonBody(req) as { deliveryId?: unknown } | null;
    const id = resourceId(typeof body?.deliveryId === "string" ? body.deliveryId : "");
    await withTransaction(async (client) => {
      const { rows: [delivery] } = await client.query<{ team_id: string }>(
        `UPDATE ops.deliveries SET status = 'QUEUED', available_at = clock_timestamp(), attempts = 0, failure_code = NULL
         WHERE delivery_id = $1 AND status = 'FAILED' RETURNING team_id`, [id],
      );
      if (!delivery) throw new HttpError(404, "Failed delivery not found");
      await audit(client, delivery.team_id, user.id, "DELIVERY_REQUEUED", id);
    });
    await processInlineDelivery(id);
    return NextResponse.json({ queued: true });
  } catch (error) {
    return handleError(error);
  }
}
