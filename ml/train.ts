import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { rowSchema, type TrainingRow } from "./contracts";
import { evaluate, tasks, type Method, type Model, type Task } from "./model";
import { demoRows } from "./demo";

const methods = ["baseline", "nearest", "weighted"] as const;

function trainingAt(task: Task, rows: TrainingRow[], cutoff: string) {
  return rows.flatMap((row) => {
    const label = row[task];
    if (row.createdAt >= cutoff || label === null ||
        (task !== "severity" && (!row.resolvedAt || row.resolvedAt >= cutoff))) return [];
    return [{ features: row.features, label }];
  });
}

export function train(rows: TrainingRow[], source: Model["source"]): Model {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const times = [...new Set(sorted.map((row) => row.createdAt))];
  if (times.length < 30) throw new Error("At least 30 distinct intake times are needed for chronological evaluation.");
  const validationStart = times[Math.floor(times.length * 0.6)];
  const testStart = times[Math.floor(times.length * 0.8)];
  const validationRows = sorted.filter((r) => r.createdAt >= validationStart && r.createdAt < testStart);
  const testRows = sorted.filter((r) => r.createdAt >= testStart);
  const models = {} as Model["models"];

  for (const task of tasks) {
    const development = trainingAt(task, sorted, validationStart);
    const knownValidation = task === "severity" ? validationRows
      : validationRows.filter((row) => row.resolvedAt && row.resolvedAt < testStart);
    const validation = {
      baseline: evaluate(task, "baseline", development, knownValidation),
      nearest: evaluate(task, "nearest", development, knownValidation),
      weighted: evaluate(task, "weighted", development, knownValidation),
    };
    const score = (method: Method) => task === "minutes"
      ? -(validation[method].mae ?? Infinity)
      : validation[method].macroF1 ?? -Infinity;
    const method = methods.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
    const training = trainingAt(task, sorted, testStart);
    const test = evaluate(task, method, training, testRows);
    const testBaseline = evaluate(task, "baseline", training, testRows);
    const improvesTest = task === "minutes"
      ? (test.mae ?? Infinity) < (testBaseline.mae ?? 0)
      : (test.macroF1 ?? 0) > (testBaseline.macroF1 ?? 1);
    const adequateClasses = task === "minutes" || (
      new Set(training.map((row) => row.label)).size > 1 &&
      [...new Set(training.map((row) => row.label))].every((label) =>
        (test.classes?.[String(label)]?.support ?? 0) >= 5 &&
        (validation[method].classes?.[String(label)]?.support ?? 0) >= 5)
    );
    models[task] = {
      method, validation, test, testBaseline, training,
      enabled: source === "synthetic" || (method !== "baseline" && improvesTest && adequateClasses && test.rows >= 20),
    };
  }
  const version = createHash("sha256").update(JSON.stringify({ source, models, validationStart, testStart }))
    .digest("hex").slice(0, 12);
  return { version, source, rows: sorted.length, split: { validationStart, testStart }, models };
}

async function main() {
  const [input, output = ".models/incident-model.json"] = process.argv.slice(2);
  if (!input) throw new Error("Usage: npm run ml:train -- --demo | <training.json> [model.json]");
  const demo = input === "--demo";
  const rows = demo ? demoRows() : z.array(rowSchema).parse(JSON.parse(await readFile(input, "utf8")));
  const model = train(rows, demo ? "synthetic" : "historical");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(model));
  console.table(tasks.map((task) => {
    const { method, enabled, test } = model.models[task];
    return { task, method, enabled, testRows: test.rows, macroF1: test.macroF1, mae: test.mae, rmse: test.rmse };
  }));
  console.log(`Saved ${model.source} model ${model.version} to ${output}`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
