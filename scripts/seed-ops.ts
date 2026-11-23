import { loadEnvConfig } from "@next/env";
import { withDemo } from "./ops-demo";

loadEnvConfig(process.cwd());
async function main() {
  const { pool, withTransaction } = await import("../lib/db");
  try {
    await withTransaction(withDemo);
    console.log("Demo workspaces are ready. Sign in as Jaanhavi, Kushi, Krishna, or Admin.");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
