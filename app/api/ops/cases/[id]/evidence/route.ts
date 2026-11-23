import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { HttpError, handleError } from "@/lib/auth";
import { actor, audit, auditDenied, jsonBody, loadCase, loadWritableCase, requireSensitive, resourceId, teamRole, workspace } from "@/lib/ops/access";
import { evidenceInput } from "@/lib/ops/contracts";
import { caseEvent } from "@/lib/ops/coordination";
import { redactSummary } from "@/lib/ops/redaction";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const user = await actor(req);
    const id = resourceId((await params).id);
    const body = evidenceInput.parse(await jsonBody(req));
    const evidenceId = await workspace(user.id, async (client) => {
      const record = await loadWritableCase(client, id);
      if (record.status === "RESOLVED") throw new HttpError(409, "Resolved case evidence is read-only");
      const evidenceId = randomUUID();
      await client.query(
        "INSERT INTO ops.evidence (evidence_id, case_id, team_id, author_id, summary, has_restricted) VALUES ($1, $2, $3, $4, $5, $6)",
        [evidenceId, id, record.team_id, user.id, redactSummary(body.summary).slice(0, 600), !!body.restricted],
      );
      if (body.restricted) {
        await client.query("INSERT INTO ops.restricted_evidence (evidence_id, team_id, detail) VALUES ($1, $2, $3)",
          [evidenceId, record.team_id, body.restricted]);
      }
      await audit(client, record.team_id, user.id, "EVIDENCE_ADDED", evidenceId);
      await caseEvent(client, record, user.id, "EVIDENCE_ADDED", "Evidence summary added");
      return evidenceId;
    });
    return NextResponse.json({ evidenceId }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(req: NextRequest, { params }: Context) {
  try {
    const user = await actor(req);
    const id = resourceId((await params).id);
    const evidenceId = resourceId(req.nextUrl.searchParams.get("id") ?? "");
    try {
      const restricted = await workspace(user.id, async (client) => {
        const record = await loadCase(client, id);
        requireSensitive(await teamRole(client, record.team_id));
        const { rows: [result] } = await client.query<{ detail: string }>(
          `SELECT r.detail FROM ops.restricted_evidence r JOIN ops.evidence e USING (evidence_id, team_id)
           WHERE e.case_id = $1 AND e.evidence_id = $2`, [id, evidenceId],
        );
        if (!result) throw new HttpError(404, "Restricted evidence not found");
        await audit(client, record.team_id, user.id, "RESTRICTED_EVIDENCE_VIEWED", evidenceId);
        return result;
      });
      return NextResponse.json(restricted, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await auditDenied(error, user.id, "RESTRICTED_EVIDENCE_DENIED", evidenceId);
      throw error;
    }
  } catch (error) {
    return handleError(error);
  }
}
