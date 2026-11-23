import { z } from "zod";

export const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const causes = [
  "DATABASE", "DEPLOYMENT", "CONFIGURATION", "INFRASTRUCTURE", "NETWORK",
  "CAPACITY", "QUEUE", "EXTERNAL_DEPENDENCY", "APPLICATION_BUG", "OTHER",
] as const;

const count = z.number().int().nonnegative();
export const featureSchema = z.object({
  text: z.string().min(1).max(10300),
  affectedServices: count.min(1),
  recentIncidents: count,
  recentDeployments: count,
  priorResolutionMinutes: z.number().nonnegative().nullable(),
  hour: count.max(23),
  weekend: z.boolean(),
});
export type Features = z.infer<typeof featureSchema>;

export const rowSchema = z.object({
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  features: featureSchema,
  severity: z.enum(severities),
  cause: z.enum(causes).nullable(),
  minutes: z.number().nonnegative().nullable(),
}).superRefine((row, ctx) => {
  if ((!row.resolvedAt && (row.cause !== null || row.minutes !== null)) ||
      (row.resolvedAt && Date.parse(row.resolvedAt) < Date.parse(row.createdAt))) {
    ctx.addIssue({ code: "custom", message: "Outcome labels require a valid resolution time" });
  }
});
export type TrainingRow = z.infer<typeof rowSchema>;

export const intakeFields = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().min(1).max(10000),
  serviceIds: z.array(z.number().int().positive()).min(1).max(20),
  primaryServiceId: z.number().int().positive(),
});
export const hasPrimary = (body: z.infer<typeof intakeFields>) =>
  body.serviceIds.includes(body.primaryServiceId);
export const intakeSchema = intakeFields.refine(hasPrimary, {
  message: "Choose a primary service from the affected services",
  path: ["primaryServiceId"],
});

export function timeFeatures(date: Date) {
  return { hour: date.getUTCHours(), weekend: [0, 6].includes(date.getUTCDay()) };
}

export type Prediction = {
  version: string;
  source: "synthetic" | "historical";
  severity: string | null;
  causes: string[];
  minutes: number | null;
  factors: string[];
};
