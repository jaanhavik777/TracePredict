import assert from "node:assert/strict";
import test from "node:test";
import { intakeSchema, rowSchema } from "../ml/contracts";
import { demoRows } from "../ml/demo";
import { predict, tasks } from "../ml/model";
import { train } from "../ml/train";

test("intake validates primary service and excludes a reported severity", () => {
  const input = { title: "API outage", description: "Gateway timing out", serviceIds: [1], primaryServiceId: 1 };
  assert.deepEqual(intakeSchema.parse({ ...input, severityId: 4 }), input);
  assert.equal(intakeSchema.safeParse({ ...input, primaryServiceId: 2 }).success, false);
});

test("chronological demo training scores all tasks and is reproducible", () => {
  const rows = demoRows();
  for (const row of rows) rowSchema.parse(row);
  const model = train(rows, "synthetic");
  assert.equal(train(rows, "synthetic").version, model.version);
  assert.ok(model.split.validationStart < model.split.testStart);
  const result = predict(model, rows.at(-1)!.features);
  assert.equal(result.source, "synthetic");
  assert.ok(result.severity);
  assert.ok(result.causes.length);
  assert.ok(result.minutes && result.minutes > 0);
  for (const task of tasks) {
    assert.equal(model.models[task].test.rows, 160);
    assert.ok(model.models[task].training.length < rows.length);
  }
});

test("resolution labels that arrive after the test boundary are excluded from training", () => {
  const rows = demoRows();
  rows[0].resolvedAt = "2028-01-01T00:00:00.000Z";
  const model = train(rows, "historical");
  assert.equal(model.models.severity.training[0].features, rows[0].features);
  assert.ok(!model.models.cause.training.some((row) => row.features === rows[0].features));
  assert.ok(!model.models.minutes.training.some((row) => row.features === rows[0].features));
});
