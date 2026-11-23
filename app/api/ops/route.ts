import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/auth";
import { actor, audit, jsonBody, requireWrite, teamRole, workspace } from "@/lib/ops/access";
import { caseInput, states, type CaseListItem, type Team, type Service } from "@/lib/ops/contracts";
import { caseEvent } from "@/lib/ops/coordination";
import { redactSummary } from "@/lib/ops/redaction";

const filters = z.object({
  teamId: z.string().uuid().optional(),
  status: z.enum(states).optional(),
  q: z.string().trim().max(100).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await actor(req);
    const filter = filters.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await workspace(user.id, async (client) => {
      if (filter.teamId) await teamRole(client, filter.teamId);
      const { rows: teams } = await client.query<Team>(
        "SELECT team_id, name, ops.access(team_id) AS role FROM ops.teams ORDER BY name",
      );
      const { rows: services } = await client.query<Service>(
        "SELECT service_id, service_name, criticality FROM services ORDER BY service_name",
      );
      const { rows: cases } = await client.query<CaseListItem>(
        `SELECT c.*, t.name AS team_name, s.service_name,
             (SELECT count(*)::int FROM ops.alerts a WHERE a.case_id = c.case_id) AS alert_count
         FROM ops.cases c JOIN ops.teams t USING (team_id) JOIN services s USING (service_id)
         WHERE ($1::uuid IS NULL OR c.team_id = $1) AND ($2::text IS NULL OR c.status = $2)
           AND ($3::text IS NULL OR strpos(lower(c.title), lower($3)) > 0
             OR strpos(lower(s.service_name), lower($3)) > 0
             OR EXISTS (SELECT FROM ops.alerts a WHERE a.case_id = c.case_id AND strpos(lower(a.message), lower($3)) > 0)
             OR EXISTS (SELECT FROM ops.evidence e WHERE e.case_id = c.case_id AND strpos(lower(e.summary), lower($3)) > 0))
         ORDER BY c.opened_at DESC LIMIT 100`,
        [filter.teamId ?? null, filter.status ?? null, filter.q || null],
      );
      const { rows: [stats] } = await client.query(
        `SELECT count(*) FILTER (WHERE status <> 'RESOLVED')::int AS active,
           count(*) FILTER (WHERE status <> 'RESOLVED' AND severity = 4)::int AS critical,
           count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
           (SELECT count(*)::int FROM ops.alerts WHERE ($1::uuid IS NULL OR team_id = $1)) AS alerts
         FROM ops.cases WHERE ($1::uuid IS NULL OR team_id = $1)`, [filter.teamId ?? null],
      );
      return { teams, services, cases, stats, admin: user.admin };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await actor(req);
    const body = caseInput.parse(await jsonBody(req));
    const id = await workspace(user.id, async (client) => {
      requireWrite(await teamRole(client, body.teamId));
      const caseId = randomUUID();
      await client.query(
        `INSERT INTO ops.cases (case_id, team_id, service_id, environment, title, category, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [caseId, body.teamId, body.serviceId, body.environment, redactSummary(body.title).slice(0, 160), body.category, body.severity],
      );
      await audit(client, body.teamId, user.id, "CASE_OPENED", caseId);
      await caseEvent(client, { team_id: body.teamId, case_id: caseId }, user.id, "CASE_OPENED", "Case opened manually");
      return caseId;
    });
    return NextResponse.json({ caseId: id }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
