import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleError, HttpError, requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { intakeFeatures, intakeHash, loadModel } from "@/lib/predictions";
import { intakeSchema } from "@/ml/contracts";
import { predict, tasks } from "@/ml/model";

async function recordHealth(outcome: "SCORED" | "UNAVAILABLE" | "ERROR", startedAt: number) {
  try {
    await query("INSERT INTO ops.prediction_health (outcome, elapsed_ms) VALUES ($1, $2)", [outcome, Date.now() - startedAt]);
  } catch {
    // Results and failure responses remain available when diagnostics storage is unavailable.
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireRole(req, ["ENGINEER"]);
    const body = intakeSchema.parse(await req.json().catch(() => ({})));
    const model = await loadModel();
    if (!model || !tasks.some((task) => model.models[task].enabled)) {
      await recordHealth("UNAVAILABLE", startedAt);
      throw new HttpError(503, "No prediction model is ready. You can still report the incident.");
    }
    const scoredAt = new Date();
    const features = await intakeFeatures(body, scoredAt);
    const result = predict(model, features);
    const id = randomUUID();
    await query(`
      WITH expired AS (
        DELETE FROM incident_predictions WHERE incident_id IS NULL
          AND scored_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
      )
      INSERT INTO incident_predictions (prediction_id, requested_by, intake_hash, features, result, scored_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, user.userId, intakeHash(body), features, result, scoredAt]);
    await recordHealth("SCORED", startedAt);
    return NextResponse.json({ id, result });
  } catch (error) {
    if ((error as { code?: string }).code === "42883" || (error as { code?: string }).code === "42P01") {
      await recordHealth("UNAVAILABLE", startedAt);
      return handleError(new HttpError(503, "Prediction storage needs its database migration. You can still report the incident."));
    }
    const response = handleError(error);
    if (response.status >= 500 && !(error instanceof HttpError)) await recordHealth("ERROR", startedAt);
    return response;
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN", "ENGINEER"]);
    const model = await loadModel();
    if (!model) return NextResponse.json(null);
    return NextResponse.json({
      version: model.version, source: model.source, rows: model.rows, split: model.split,
      tasks: tasks.map((task) => {
        const { training, ...report } = model.models[task];
        return { task, ...report };
      }),
    });
  } catch (error) {
    return handleError(error);
  }
}
