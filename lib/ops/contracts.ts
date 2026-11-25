import { z } from "zod";

export const environments = ["production", "staging", "development"] as const;
export const categories = ["ACCESS", "AUTHENTICATION", "INTEGRITY", "AVAILABILITY", "OTHER"] as const;
export const memberRoles = ["RESPONDER", "LEAD", "AUDITOR"] as const;
export const states = ["OPEN", "INVESTIGATING", "RESOLVED"] as const;

export type TeamRole = (typeof memberRoles)[number] | "ADMIN";
export type CaseState = (typeof states)[number];
export const severityNames = ["", "Low", "Medium", "High", "Critical"] as const;

export const caseInput = z.object({
  teamId: z.string().uuid(),
  serviceId: z.number().int().positive(),
  environment: z.enum(environments),
  title: z.string().trim().min(3).max(160),
  category: z.enum(categories),
  severity: z.number().int().min(1).max(4),
});

export const alertInput = caseInput.omit({ teamId: true }).extend({
  eventId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(600),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export const evidenceInput = z.object({
  summary: z.string().trim().min(3).max(600),
  restricted: z.string().trim().min(1).max(4000).optional(),
});

export const statusInput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("INVESTIGATING") }),
  z.object({ status: z.literal("RESOLVED"), resolution: z.string().trim().min(10).max(2000) }),
]);

export type Team = { team_id: string; name: string; role: TeamRole; customer_workspace?: boolean };
export type Service = { service_id: number; service_name: string; criticality: string; team_id?: string | null };
export type SecurityCase = {
  case_id: string; team_id: string; team_name: string;
  service_id: number; service_name: string; environment: string; title: string;
  category: string; status: CaseState; severity: number; opened_at: string;
  last_signal_at: string | null; resolved_at: string | null; resolution: string | null;
  owner_id: number | null; acknowledged_at: string | null; ack_due_at: string | null;
  escalated_at: string | null; runbook_id: string | null; checked_steps: number[];
};
export type CaseListItem = SecurityCase & { alert_count: number };
export type Signal = {
  alert_id: string; title: string; message: string; severity: number;
  occurred_at: string; received_at: string; issue_url?: string | null;
};
export type Evidence = { evidence_id: string; summary: string; recorded_at: string; author_id: number; has_restricted: boolean };
export type Audit = {
  audit_id: string; action: string; actor_id: number | null; team_id: string | null; target: string | null;
  recorded_at: string; subject_user_id: number | null; membership_role: string | null;
};
