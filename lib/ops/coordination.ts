import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { HttpError } from "@/lib/auth";

export type CaseReference = { case_id: string; team_id: string };
export type CaseEvent = { event_id: string; actor_id: number | null; kind: string; detail: string; created_at: string };
export type Owner = { user_id: number; full_name: string };
export type Followup = { followup_id: string; title: string; owner_id: number | null; due_on: string; done_at: string | null };
export type Coordination = {
  owners: Owner[];
  runbook: { name: string; version: number; steps: string[] } | null;
  events: CaseEvent[];
  followups: Followup[];
};
const user = z.number().int().positive();
export const coordinationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge") }),
  z.object({ action: z.literal("handoff"), ownerId: user.nullable(), note: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("check"), step: z.number().int().nonnegative(), checked: z.boolean() }),
  z.object({ action: z.literal("followup"), title: z.string().trim().min(3).max(180), ownerId: user, dueOn: z.string().date() }),
  z.object({ action: z.literal("complete"), followupId: z.string().uuid() }),
]);

export async function caseEvent(client: PoolClient, record: CaseReference, actorId: number | null, kind: string, detail: string) {
  await client.query(
    "INSERT INTO ops.case_events (event_id, team_id, case_id, actor_id, kind, detail) VALUES ($1, $2, $3, $4, $5, $6)",
    [randomUUID(), record.team_id, record.case_id, actorId, kind, detail],
  );
}

export async function coordination(client: PoolClient, record: CaseReference & { runbook_id: string | null }): Promise<Coordination> {
  const { rows: owners } = await client.query<Owner>("SELECT * FROM ops.eligible_owners($1)", [record.team_id]);
  const { rows: [runbook] } = await client.query<NonNullable<Coordination["runbook"]>>(
    "SELECT name, version, steps FROM ops.runbooks WHERE runbook_id = $1", [record.runbook_id],
  );
  const { rows: events } = await client.query<CaseEvent>(
    "SELECT event_id, actor_id, kind, detail, created_at FROM ops.case_events WHERE case_id = $1 ORDER BY created_at DESC LIMIT 100",
    [record.case_id],
  );
  const { rows: followups } = await client.query<Followup>(
    "SELECT followup_id, title, owner_id, to_char(due_on, 'YYYY-MM-DD') AS due_on, done_at FROM ops.followups WHERE case_id = $1 ORDER BY due_on, followup_id",
    [record.case_id],
  );
  return { owners, runbook: runbook ?? null, events, followups };
}

export async function eligibleOwner(client: PoolClient, record: CaseReference, ownerId: number) {
  const { rows: [owner] } = await client.query<Owner>(
    "SELECT * FROM ops.eligible_owners($1) WHERE user_id = $2", [record.team_id, ownerId],
  );
  if (!owner) throw new HttpError(400, "Choose an active responder or lead from this team");
  return owner;
}
