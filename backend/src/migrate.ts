import { readFile } from "node:fs/promises";
import pg from "pg";
import { env } from "./config.js";
const db = new pg.Pool({ connectionString: env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(727319)");
  await client.query(
    await readFile(
      new URL("../migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await db.end();
}
