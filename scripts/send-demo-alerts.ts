import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { signAlert, webhookKey } from "../lib/ops/webhook";

loadEnvConfig(process.cwd());

async function main() {
  const app = new URL(process.argv[2] ?? "http://127.0.0.1:3037");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)) {
    throw new Error("Send demo alerts to a local TracePredict instance");
  }
  const source = "6bae44c1-b61e-4c52-bb06-69ce448a0386";
  const key = webhookKey(source);
  const { query, pool } = await import("../lib/db");
  let serviceId: number;
  try {
    const [service] = await query<{ service_id: number }>(
      "SELECT service_id FROM services WHERE service_name = 'Auth Service'",
    );
    if (!service) throw new Error("The demo Auth Service is missing");
    serviceId = service.service_id;
  } finally {
    await pool.end();
  }
  const input = {
    eventId: randomUUID(), serviceId, category: "ACCESS", environment: "production",
    severity: 3, title: "Unexpected privilege change", occurredAt: new Date().toISOString(),
    message: "Synthetic identity monitor signal for an unplanned role change.",
  };
  for (const next of [input, input, {
    ...input, eventId: randomUUID(), severity: 4, title: "Second privilege change in the same service",
  }]) {
    const body = Buffer.from(JSON.stringify(next));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(new URL(`/api/webhooks/alerts/${source}`, app), {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-trace-timestamp": timestamp,
        "x-trace-signature": "sha256=" + signAlert(key, timestamp, body) },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The alert was not accepted");
    console.log(`${result.duplicate ? "Duplicate acknowledged" : "Alert queued"} · ${result.deliveryId ?? result.caseId}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
