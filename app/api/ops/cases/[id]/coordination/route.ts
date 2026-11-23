import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { HttpError, handleError } from "@/lib/auth";
import { actor, audit, jsonBody, loadWritableCase, resourceId, workspace } from "@/lib/ops/access";
import { caseEvent, coordinationInput, eligibleOwner } from "@/lib/ops/coordination";
import { redactSummary } from "@/lib/ops/redaction";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await actor(req);
    const id = resourceId((await params).id);
    const body = coordinationInput.parse(await jsonBody(req));
    await workspace(user.id, async (client) => {
      const record = await loadWritableCase(client, id);
      if (record.status === "RESOLVED" && !["followup", "complete"].includes(body.action)) {
        throw new HttpError(409, "This action requires an active case");
      }
      let detail: string;
      switch (body.action) {
        case "acknowledge":
          if (record.acknowledged_at) return;
          await client.query("UPDATE ops.cases SET acknowledged_at = clock_timestamp() WHERE case_id = $1", [id]);
          detail = "Case acknowledged";
          break;
        case "handoff": {
          const owner = body.ownerId ? await eligibleOwner(client, record, body.ownerId) : null;
          const next = owner ? owner.full_name : "unassigned";
          detail = `Owner changed from ${record.owner_id ? `user #${record.owner_id}` : "unassigned"} to ${next}. ${redactSummary(body.note)}`;
          await client.query("UPDATE ops.cases SET owner_id = $2 WHERE case_id = $1", [id, owner?.user_id ?? null]);
          break;
        }
        case "check": {
          const { rows: [runbook] } = await client.query<{ steps: string[] }>(
            "SELECT steps FROM ops.runbooks WHERE runbook_id = $1", [record.runbook_id],
          );
          const step = runbook?.steps[body.step];
          if (!step) throw new HttpError(400, "Unknown runbook step");
          const checks = new Set(record.checked_steps);
          if (checks.has(body.step) === body.checked) return;
          if (body.checked) checks.add(body.step); else checks.delete(body.step);
          await client.query("UPDATE ops.cases SET checked_steps = $2 WHERE case_id = $1", [id, [...checks]]);
          detail = `${body.checked ? "Completed" : "Reopened"}: ${step}`;
          break;
        }
        case "followup": {
          const owner = await eligibleOwner(client, record, body.ownerId);
          const title = redactSummary(body.title).slice(0, 180);
          await client.query(
            `INSERT INTO ops.followups (followup_id, case_id, team_id, title, owner_id, due_on)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), id, record.team_id, title, owner.user_id, body.dueOn],
          );
          detail = `Follow-up: ${title} · ${owner.full_name} · due ${body.dueOn}`;
          break;
        }
        case "complete": {
          const { rows: [item] } = await client.query<{ title: string }>(
            `UPDATE ops.followups SET done_at = clock_timestamp()
             WHERE case_id = $1 AND followup_id = $2 AND done_at IS NULL RETURNING title`,
            [id, body.followupId],
          );
          if (!item) throw new HttpError(404, "Open follow-up not found");
          detail = "Follow-up completed: " + item.title;
          break;
        }
      }
      const action = body.action.toUpperCase();
      await caseEvent(client, record, user.id, action, detail);
      await audit(client, record.team_id, user.id, "CASE_" + action, id);
    });
    return NextResponse.json({ saved: true });
  } catch (error) {
    return handleError(error);
  }
}
