import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { withDemo } from "./ops-demo";

const migrations = ["10_predictions.sql", "11_security_ops.sql", "12_response_ops.sql", "13_product_workspaces.sql"];

async function main() {
  loadEnvConfig(process.cwd());
  const { pool, withTransaction } = await import("../lib/db");
  const deploy = process.argv.includes("--deploy");
  const migrate = process.argv.includes("--migrate");
  const demo = process.argv.includes("--demo-users");
  try {
    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tracepredict-schema', 0))");
      const { rows: [schema] } = await client.query("SELECT to_regclass('incidents') IS NOT NULL AS initialized");
      if (schema.initialized && !migrate && !deploy) throw new Error("Database already initialized. Use npm run db:migrate.");
      if (!schema.initialized && migrate) throw new Error("Initialize the database before migrating.");
      const base = schema.initialized ? [] : [
        "01_ddl.sql", deploy ? "02_hosted_lookups.sql" : "02_seed_base.sql",
        "03_jaanhavi_triggers_functions.sql", "04_kushi_views.sql",
        ...(deploy ? [] : ["05_jaanhavi_seed_incidents.sql"]),
      ];
      for (const file of [...base, ...migrations]) await client.query(await readFile(`sql/${file}`, "utf8"));
      if (!schema.initialized && demo && !deploy) {
        await client.query("UPDATE users SET password_hash = $1", [await bcrypt.hash("Password@123", 10)]);
        await withDemo(client);
      }
    });
    console.log("TracePredict database is ready.");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
