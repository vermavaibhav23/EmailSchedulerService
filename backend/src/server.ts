import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import helmet from "helmet";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { z } from "zod";
import {
  db,
  redis,
  emailQueue,
  maintenanceQueue,
  search,
  index,
} from "./infra.js";
import { env } from "./config.js";
import { auth, authRequired, csrfRequired } from "./auth.js";
import { encrypt } from "./crypto.js";
import { scheduleSchema, plannedTimes } from "./validation.js";
const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      },
    },
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    store: new RedisStore({ client: redis, prefix: "session:" }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 86400000,
    },
  }),
);
app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await Promise.all([db.query("SELECT 1"), redis.ping(), search.ping()]);
    const heartbeat = await redis.get("worker-heartbeat");
    if (!heartbeat) throw new Error("Worker unavailable");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.use(auth);
const api = express.Router();
api.use(authRequired, csrfRequired);
api.get("/me", async (req, res, next) => {
  try {
    const {
      rows: [user],
    } = await db.query("SELECT id,name,email,avatar FROM users WHERE id=$1", [
      req.session.userId,
    ]);
    if (!req.session.csrf) req.session.csrf = randomUUID();
    res.json({
      user,
      csrfToken: req.session.csrf,
      admin: env.ADMIN_EMAILS.split(",").includes(user.email),
    });
  } catch (e) {
    next(e);
  }
});
api.post("/logout", (req, res, next) =>
  req.session.destroy((err) => {
    if (err) next(err);
    else {
      res.clearCookie("connect.sid");
      res.status(204).end();
    }
  }),
);
api.get("/settings", (_req, res) =>
  res.json({
    minDelayMs: env.MIN_SEND_DELAY_MS,
    maxHourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    maxRecipients: env.MAX_CAMPAIGN_RECIPIENTS,
  }),
);
api.get("/senders", async (req, res, next) => {
  try {
    res.json({
      senders: (
        await db.query(
          "SELECT id,name,email,hourly_limit FROM senders WHERE user_id=$1 ORDER BY created_at",
          [req.session.userId],
        )
      ).rows,
    });
  } catch (e) {
    next(e);
  }
});
api.post("/senders/ethereal", async (req, res, next) => {
  try {
    const name = z.string().trim().min(1).max(100).parse(req.body.name);
    const quota = await redis.incr(`sender-create:${req.session.userId}`);
    if (quota === 1)
      await redis.expire(`sender-create:${req.session.userId}`, 3600);
    if (quota > 10) {
      res.status(429).json({ error: "Maximum 10 sender creations per hour" });
      return;
    }
    const account = await nodemailer.createTestAccount();
    const secret = encrypt(
      {
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        user: account.user,
        pass: account.pass,
      },
      env.ENCRYPTION_KEY,
    );
    const {
      rows: [sender],
    } = await db.query(
      "INSERT INTO senders(id,user_id,name,email,smtp_secret,hourly_limit) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,hourly_limit",
      [
        randomUUID(),
        req.session.userId,
        name,
        account.user,
        secret,
        env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      ],
    );
    res.status(201).json({ sender });
  } catch (e) {
    next(e);
  }
});
api.post("/campaigns", async (req, res, next) => {
  let client;
  try {
    client = await db.connect();
  } catch (error) {
    next(error);
    return;
  }
  try {
    const data = scheduleSchema.parse(req.body);
    const key = z.string().min(8).max(200).parse(req.get("idempotency-key"));
    const hash = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${req.session.userId}:${key}`,
    ]);
    const {
      rows: [existing],
    } = await client.query(
      "SELECT id,request_hash FROM campaigns WHERE user_id=$1 AND idempotency_key=$2",
      [req.session.userId, key],
    );
    if (existing) {
      await client.query("COMMIT");
      if (existing.request_hash !== hash) {
        res.status(409).json({
          error: "Idempotency key was already used for different content",
        });
        return;
      }
      res.json({ campaignId: existing.id, replayed: true });
      return;
    }
    const recipients = [
      ...new Set(data.recipients.map((r) => r.toLowerCase())),
    ];
    if (recipients.length > env.MAX_CAMPAIGN_RECIPIENTS)
      throw new Error("Too many recipients");
    const start = Date.parse(data.startAt);
    if (start < Date.now() - 30000 || start > Date.now() + 365 * 86400000) {
      res
        .status(400)
        .json({ error: "Choose a start time within the next year" });
      await client.query("ROLLBACK");
      return;
    }
    const {
      rows: [sender],
    } = await client.query(
      "SELECT id FROM senders WHERE id=$1 AND user_id=$2",
      [data.senderId, req.session.userId],
    );
    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      await client.query("ROLLBACK");
      return;
    }
    const id = randomUUID();
    const delay = Math.max(data.delayMs, env.MIN_SEND_DELAY_MS);
    const cap = Math.min(data.hourlyLimit, env.MAX_EMAILS_PER_HOUR_PER_SENDER);
    await client.query(
      "INSERT INTO campaigns(id,user_id,sender_id,subject,body,start_at,delay_ms,hourly_limit,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        req.session.userId,
        data.senderId,
        data.subject,
        data.body,
        data.startAt,
        delay,
        cap,
        key,
        hash,
      ],
    );
    const dates = plannedTimes(start, recipients.length, delay);
    await client.query(
      `INSERT INTO emails(id,user_id,campaign_id,sender_id,recipient,subject,body,scheduled_at) SELECT x.id,$1,$2,$3,x.recipient,$4,$5,x.scheduled_at FROM jsonb_to_recordset($6::jsonb) AS x(id uuid,recipient text,scheduled_at timestamptz)`,
      [
        req.session.userId,
        id,
        data.senderId,
        data.subject,
        data.body,
        JSON.stringify(
          recipients.map((recipient, i) => ({
            id: randomUUID(),
            recipient,
            scheduled_at: dates[i],
          })),
        ),
      ],
    );
    await client.query("COMMIT");
    res.status(201).json({
      campaignId: id,
      count: recipients.length,
      delayMs: delay,
      hourlyLimit: cap,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});
api.get("/emails", async (req, res, next) => {
  try {
    const view = z
      .enum(["scheduled", "sent"])
      .default("scheduled")
      .parse(req.query.view);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .default(1)
      .parse(req.query.page);
    const q = z.string().max(200).default("").parse(req.query.q);
    const statuses =
      view === "scheduled"
        ? ["scheduled", "sending"]
        : ["sent", "failed", "uncertain"];
    let ids: string[] | null = null;
    if (q) {
      try {
        const found = await search.search<{ id: string }>({
          index,
          size: 10000,
          query: {
            bool: {
              filter: [
                { term: { user_id: req.session.userId } },
                { terms: { status: statuses } },
              ],
              must: [
                {
                  multi_match: {
                    query: q,
                    fields: ["recipient", "subject", "body"],
                    type: "phrase_prefix",
                  },
                },
              ],
            },
          },
        });
        ids = found.hits.hits.map((h) => h._id!);
      } catch {
        res.status(503).json({
          error:
            "Search is temporarily unavailable. Clear the search to browse emails.",
        });
        return;
      }
    }
    const filter =
      "user_id=$1 AND status=ANY($2::text[]) AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[]))";
    const params = [req.session.userId, statuses, ids];
    const {
      rows: [total],
    } = await db.query(
      `SELECT count(*)::int AS count FROM emails WHERE ${filter}`,
      params,
    );
    const { rows } = await db.query(
      `SELECT id,recipient,subject,body,status,scheduled_at,sent_at,preview_url,error FROM emails WHERE ${filter} ORDER BY COALESCE(sent_at,scheduled_at) DESC,id LIMIT 25 OFFSET $4`,
      [...params, (page - 1) * 25],
    );
    res.json({
      emails: rows,
      total: total.count,
      page,
      pageSize: 25,
      searchTruncated: ids?.length === 10000,
    });
  } catch (e) {
    next(e);
  }
});
api.get("/stats", async (req, res, next) => {
  try {
    res.json(
      (
        await db.query(
          `SELECT count(*) FILTER(WHERE status IN ('scheduled','sending'))::int AS scheduled,count(*) FILTER(WHERE status IN ('sent','failed','uncertain'))::int AS sent FROM emails WHERE user_id=$1`,
          [req.session.userId],
        )
      ).rows[0],
    );
  } catch (e) {
    next(e);
  }
});
api.get("/slack", async (req, res, next) => {
  try {
    res.json({
      connection:
        (
          await db.query(
            "SELECT team_name,channel_name FROM slack_connections WHERE user_id=$1",
            [req.session.userId],
          )
        ).rows[0] || null,
    });
  } catch (e) {
    next(e);
  }
});
api.delete("/slack", async (req, res, next) => {
  try {
    await db.query("DELETE FROM slack_connections WHERE user_id=$1", [
      req.session.userId,
    ]);
    await db.query(
      "DELETE FROM notifications WHERE user_id=$1 AND delivered_at IS NULL",
      [req.session.userId],
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
app.use("/api", api);
const board = new ExpressAdapter();
board.setBasePath("/admin/queues");
createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue, { readOnlyMode: true }),
    new BullMQAdapter(maintenanceQueue, { readOnlyMode: true }),
  ],
  serverAdapter: board,
});
app.use(
  "/admin/queues",
  authRequired,
  async (req, res, next) => {
    try {
      const {
        rows: [user],
      } = await db.query("SELECT email FROM users WHERE id=$1", [
        req.session.userId,
      ]);
      if (!env.ADMIN_EMAILS.split(",").includes(user?.email)) {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  },
  helmet({
    contentSecurityPolicy: {
      directives: { scriptSrc: ["'self'", "'unsafe-inline'"] },
    },
  }),
  board.getRouter(),
);
app.use(
  express.static(
    fileURLToPath(new URL("../../frontend/dist", import.meta.url)),
  ),
);
app.get("*", (req, res) => {
  if (/^\/(api|auth|integrations|health)(\/|$)/.test(req.path)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(
    fileURLToPath(new URL("../../frontend/dist/index.html", import.meta.url)),
  );
});
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    console.error(
      "Request failed",
      error instanceof Error ? error.message : "Unknown",
    );
    res
      .status(500)
      .json({ error: "The request could not be completed. Please try again." });
  },
);
const server = app.listen(env.PORT, "0.0.0.0", () =>
  console.log(`API listening on ${env.PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await Promise.all([
        db.end(),
        emailQueue.close(),
        maintenanceQueue.close(),
        search.close(),
      ]);
      redis.disconnect();
      process.exit(0);
    }),
  );
