import pg from "pg";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { Client } from "@elastic/elasticsearch";
import { env } from "./config.js";
export const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const emailQueue = new Queue("emails", { connection: redis });
export const maintenanceQueue = new Queue("maintenance", { connection: redis });
export const search = new Client({
  node: env.ELASTICSEARCH_URL,
  ...(env.ELASTICSEARCH_API_KEY
    ? { auth: { apiKey: env.ELASTICSEARCH_API_KEY } }
    : env.ELASTICSEARCH_PASSWORD
      ? { auth: { username: "elastic", password: env.ELASTICSEARCH_PASSWORD } }
      : {}),
});
export const index = "scheduler-emails";
