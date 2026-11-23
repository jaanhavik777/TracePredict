import { NextRequest, NextResponse } from "next/server";
import { HttpError, handleError } from "@/lib/auth";
import { actor, audit, auditDenied, jsonBody, loadCase, loadWritableCase, requireSensitive, resourceId, teamRole, workspace } from "@/lib/ops/access";
import { statusInput, type Evidence, type Signal } from "@/lib/ops/contracts";
import { caseEvent, coordination } from "@/lib/ops/coordination";
import { caseImpact } from "@/lib/ops/impact";
import { redactSummary } from "@/lib/ops/redaction";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  try {
    const user = await actor(req);
    const id = resourceId((await params).id);
    const format = req.nextUrl.searchParams.get("format");
    const postmortem = format === "postmortem";
    const exporting = format === "json" || postmortem;
    try {
      const report = await workspace(user.id, async (client) => {
        const record = await loadCase(client, id);
        const role = await teamRole(client, record.team_id);
        if (exporting) requireSensitive(role);
        if (postmortem && record.status !== "RESOLVED") throw new HttpError(409, "Resolve the case before drafting its postmortem");
        const cap = exporting ? null : 100;
        const { rows: signals } = await client.query<Signal>(
          `SELECT alert_id, title, message, severity, occurred_at, received_at FROM ops.alerts
           WHERE case_id = $1 ORDER BY received_at DESC LIMIT $2`, [id, cap],
        );
        const { rows: evidence } = await client.query<Evidence>(
          `SELECT evidence_id, summary, recorded_at, author_id, has_restricted FROM ops.evidence
           WHERE case_id = $1 ORDER BY recorded_at DESC LIMIT $2`, [id, cap],
        );
        const impact = await caseImpact(client, record.service_id, record.environment, record.opened_at);
        const response = await coordination(client, record);
        await audit(client, record.team_id, user.id, postmortem ? "POSTMORTEM_EXPORTED" : exporting ? "CASE_EXPORTED" : "CASE_VIEWED", id);
        return { case: record, role, signals, evidence, impact, coordination: response };
      });
      if (postmortem) {
        const { case: record, coordination: response } = report;
        const owner = (id: number | null) => response.owners.find((item) => item.user_id === id)?.full_name
          ?? (id === null ? "Unassigned" : `User #${id}`);
        const draft = [
          `# ${record.title}`, "",
          `Service: ${record.service_name} (${record.environment})`,
          `Opened: ${new Date(record.opened_at).toISOString()}`,
          `Resolved: ${record.resolved_at ? new Date(record.resolved_at).toISOString() : "Pending"}`,
          `Owner: ${owner(record.owner_id)}`, "",
          "## Recorded resolution", record.resolution ?? "", "",
          "## Timeline",
          ...[...response.events].reverse().map((event) => `- ${new Date(event.created_at).toISOString()} — ${event.detail}`),
          "", "## Follow-up actions",
          ...response.followups.map((item) => `- [${item.done_at ? "x" : " "}] ${item.title} (${owner(item.owner_id)}, due ${item.due_on})`),
        ].join("\n");
        return new NextResponse(draft, { headers: {
          "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="postmortem-${id}.md"`,
        } });
      }
      return NextResponse.json(report, { headers: {
        "Cache-Control": "no-store",
        ...(exporting ? { "Content-Disposition": `attachment; filename="tracepredict-case-${id}.json"` } : {}),
      } });
    } catch (error) {
      await auditDenied(error, user.id, exporting ? "EXPORT_DENIED" : "CASE_ACCESS_DENIED", id);
      throw error;
    }
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await actor(req);
    const id = resourceId((await params).id);
    const body = statusInput.parse(await jsonBody(req));
    await workspace(user.id, async (client) => {
      const record = await loadWritableCase(client, id);
      if ((record.status === "OPEN" && body.status !== "INVESTIGATING") ||
          (record.status === "INVESTIGATING" && body.status !== "RESOLVED") ||
          record.status === "RESOLVED") throw new HttpError(409, "Invalid status transition");

      await client.query(
        `UPDATE ops.cases SET status = $2,
         resolved_at = CASE WHEN $2 = 'RESOLVED' THEN clock_timestamp() ELSE NULL END,
         acknowledged_at = coalesce(acknowledged_at, clock_timestamp()),
         resolution = $3 WHERE case_id = $1`,
        [id, body.status, body.status === "RESOLVED" ? redactSummary(body.resolution) : null],
      );
      await caseEvent(client, record, user.id, "CASE_" + body.status,
        body.status === "RESOLVED" ? redactSummary(body.resolution) : "Investigation started");
      await audit(client, record.team_id, user.id, "CASE_" + body.status, id);
    });
    return NextResponse.json({ caseId: id, status: body.status });
  } catch (error) {
    return handleError(error);
  }
}
