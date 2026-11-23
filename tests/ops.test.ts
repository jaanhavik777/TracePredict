import assert from "node:assert/strict";
import test from "node:test";
import { impactPaths } from "../lib/ops/impact";
import { redactSummary } from "../lib/ops/redaction";
import { signAlert, validAlertSignature } from "../lib/ops/webhook";

test("webhook digest binds raw bytes and enforces the timestamp window", () => {
  const timestamp = "1780000000";
  const now = Number(timestamp) * 1000;
  const key = "local-test-key";
  const body = Buffer.from('{"message":"test alert"}');
  const signature = "sha256=" + signAlert(key, timestamp, body);
  assert.equal(validAlertSignature(key, timestamp, signature, body, now), true);
  assert.equal(validAlertSignature(key, timestamp, signature, Buffer.from('{"message":"changed"}'), now), false);
  assert.equal(validAlertSignature(key, timestamp, signature, body, now + 301_000), false);
  assert.equal(validAlertSignature(key, timestamp, "sha256=0", body, now), false);
});

test("impact paths distinguish both directions and terminate on a shared cycle", () => {
  const services = [1, 2, 3, 4].map((id) => ({ service_id: id, service_name: "Service " + id, criticality: "HIGH" }));
  const dependencies = [
    { service_id: 1, depends_on_service_id: 2 },
    { service_id: 2, depends_on_service_id: 1 },
    { service_id: 3, depends_on_service_id: 1 },
    { service_id: 4, depends_on_service_id: 3 },
  ];
  const result = impactPaths(services, dependencies, [1]);
  assert.deepEqual(result.filter((node) => node.relation === "UPSTREAM").map((node) => node.path), [[1, 2]]);
  assert.deepEqual(result.filter((node) => node.relation === "DOWNSTREAM").map((node) => node.path), [[1, 2], [1, 3], [1, 3, 4]]);
  assert.equal(impactPaths(services, dependencies, [1], 1).some((node) => node.service_id === 4), false);
});

test("shared text masks common secrets and identifying fields", () => {
  const summary = redactSummary("Bearer synthetic-token password='some words', demo@example.com, 192.0.2.20");
  assert.equal(summary, "Bearer [redacted] password=[redacted], [email redacted], [IP redacted]");
});
