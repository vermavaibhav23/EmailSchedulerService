import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    NODE_ENV: z.string().trim().default("development"),
    PORT: z.coerce.number().default(3000),
    APP_URL: z
      .string()
      .trim()
      .url()
      .transform((value) => value.replace(/\/+$/, "")),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string().url(),
    ELASTICSEARCH_URL: z.string().url(),
    ELASTICSEARCH_API_KEY: z.string().optional(),
    ELASTICSEARCH_PASSWORD: z.string().optional(),
    SESSION_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
    GOOGLE_CLIENT_ID: z.string().trim().default(""),
    GOOGLE_CLIENT_SECRET: z.string().trim().default(""),
    SLACK_CLIENT_ID: z.string().trim().default(""),
    SLACK_CLIENT_SECRET: z.string().trim().default(""),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
    MIN_SEND_DELAY_MS: z.coerce.number().int().min(1).default(2000),
    MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
    MAX_CAMPAIGN_RECIPIENTS: z.coerce.number().int().min(1).default(10000),
    ADMIN_EMAILS: z.string().default(""),
  })
  .parse(process.env);
export const googleOAuthConfigured =
  Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);
if (env.NODE_ENV === "production" && /^0+$/.test(env.ENCRYPTION_KEY))
  throw new Error("Set a random production encryption key");
