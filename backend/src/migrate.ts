import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { env } from "./config.js";
const db = new pg.Pool({ connectionString: env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(727319)");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(await readFile(new URL(file, directory), "utf8"));
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await db.end();
}
