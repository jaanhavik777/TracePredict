import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { withDemo } from "./ops-demo";

const migrations = ["10_predictions.sql", "11_security_ops.sql", "12_response_ops.sql"];

async function main() {
  loadEnvConfig(process.cwd());
  const { pool } = await import("../lib/db");
  const migrate = process.argv.includes("--migrate");
  try {
    if (migrate) {
      for (const file of migrations) await pool.query(await readFile(`sql/${file}`, "utf8"));
      console.log("Applied the TracePredict migrations.");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [schema] } = await client.query("SELECT to_regclass('incidents') IS NOT NULL AS initialized");
      if (schema.initialized) throw new Error("Database already initialized. Use npm run db:migrate.");
      for (const file of [
        "01_ddl.sql", "02_seed_base.sql", "03_jaanhavi_triggers_functions.sql",
        "04_kushi_views.sql", "05_jaanhavi_seed_incidents.sql", ...migrations,
      ]) {
        await client.query(await readFile(`sql/${file}`, "utf8"));
      }
      if (process.argv.includes("--demo-users")) {
        await client.query("UPDATE users SET password_hash = $1", [await bcrypt.hash("Password@123", 10)]);
        await withDemo(client);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("Initialized TracePredict.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
