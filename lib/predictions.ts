import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { z } from "zod";
import { query } from "./db";
import { HttpError } from "./auth";
import { featureSchema, timeFeatures, type intakeSchema } from "../ml/contracts";
import type { Model } from "../ml/model";

type Intake = z.infer<typeof intakeSchema>;
let cached: { path: string; modified: number; model: Model } | undefined;

export async function loadModel(): Promise<Model | null> {
  const path = process.env.INCIDENT_MODEL_PATH ?? ".models/incident-model.json";
  try {
    const { mtimeMs } = await stat(path);
    if (cached?.path === path && cached.modified === mtimeMs) return cached.model;
    const model: Model = JSON.parse(await readFile(path, "utf8"));
    cached = { path, modified: mtimeMs, model };
    return model;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not load incident model", error);
    return null;
  }
}

export function intakeHash(body: Intake) {
  return createHash("sha256").update(JSON.stringify([
    body.title, body.description, body.primaryServiceId,
    [...new Set(body.serviceIds)].sort((a, b) => a - b),
  ])).digest("hex");
}

export async function intakeFeatures(body: Intake, date: Date) {
  const serviceIds = [...new Set(body.serviceIds)];
  const [row] = await query<{
    service_count: number; recent_incidents: number;
    recent_deployments: number; prior_resolution_minutes: number | null;
  }>(`
    SELECT (SELECT COUNT(*)::INT FROM services WHERE service_id = ANY($1::INT[])) AS service_count, c.*
    FROM prediction_context($2, $3::TIMESTAMPTZ AT TIME ZONE 'UTC') c
  `, [serviceIds, body.primaryServiceId, date]);
  if (row.service_count !== serviceIds.length) throw new HttpError(400, "An affected service does not exist");
  return featureSchema.parse({
    text: body.title + " " + body.description,
    affectedServices: row.service_count,
    recentIncidents: row.recent_incidents,
    recentDeployments: row.recent_deployments,
    priorResolutionMinutes: row.prior_resolution_minutes,
    ...timeFeatures(date),
  });
}
