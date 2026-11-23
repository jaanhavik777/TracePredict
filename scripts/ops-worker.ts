import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  const { workDelivery, enforceCasePolicies } = await import("../lib/ops/worker");
  const { pool } = await import("../lib/db");
  const once = process.argv.includes("--once");
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });
  console.log(once ? "Processing available Security Ops jobs" : "Security Ops worker is running");
  try {
    do {
      try {
        for (let count = 0; count < 100 && !stopping; count++) {
          if (!await workDelivery()) break;
        }
        await enforceCasePolicies();
      } catch (error) {
        console.error("Security Ops worker iteration failed:", (error as Error).message);
        if (once) throw error;
      }
      if (!once && !stopping) await delay(1500);
    } while (!once && !stopping);
  } finally {
    await pool.end();
  }
}

main().catch(() => { process.exitCode = 1; });
