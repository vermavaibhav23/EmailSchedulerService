import { Worker, DelayedError } from "bullmq";
import nodemailer from "nodemailer";
import {
  db,
  redis,
  emailQueue,
  maintenanceQueue,
  search,
  index,
} from "./infra.js";
import { env } from "./config.js";
import { decrypt } from "./crypto.js";
import { gateScript } from "./rate-limit.js";

type Smtp = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};
async function notify(
  userId: string,
  senderId: string,
  hour: number,
  email: string,
  cap: number,
) {
  await db.query(
    `INSERT INTO notifications(id,user_id,text) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM slack_connections WHERE user_id=$2) ON CONFLICT DO NOTHING`,
    [
      `${senderId}-${hour}`,
      userId,
      `Hourly sending limit (${cap}) reached for ${email}. Remaining emails are queued for the next UTC hour.`,
    ],
  );
}
const worker = new Worker(
  "emails",
  async (job, token) => {
    const {
      rows: [mail],
    } = await db.query(
      `SELECT e.*,s.smtp_secret,s.email AS sender_email,s.hourly_limit AS sender_limit,c.delay_ms,c.hourly_limit AS campaign_limit,u.email AS owner_email,u.name AS owner_name FROM emails e JOIN senders s ON s.id=e.sender_id JOIN campaigns c ON c.id=e.campaign_id JOIN users u ON u.id=e.user_id WHERE e.id=$1`,
      [job.data.emailId],
    );
    if (!mail || mail.status !== "scheduled") return;
    const cap = Math.min(
      mail.sender_limit,
      mail.campaign_limit,
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );
    const delay = Math.max(mail.delay_ms, env.MIN_SEND_DELAY_MS);
    const [next, limited, hour, count] = (await redis.eval(
      gateScript,
      1,
      `sender-gate:${mail.sender_id}`,
      cap,
      delay,
    )) as number[];
    if (limited || count === cap)
      await notify(mail.user_id, mail.sender_id, hour, mail.sender_email, cap);
    if (next) {
      await db.query(
        "UPDATE emails SET scheduled_at=$2,version=version+1 WHERE id=$1 AND status='scheduled'",
        [mail.id, new Date(next)],
      );
      await job.moveToDelayed(next, token);
      throw new DelayedError();
    }
    // Commit the attempt BEFORE SMTP. A retry can never blindly send a second copy.
    const claimed = await db.query(
      `UPDATE emails SET status='sending',attempted_at=now(),version=version+1 WHERE id=$1 AND status='scheduled' RETURNING id`,
      [mail.id],
    );
    if (!claimed.rowCount) return;
    const smtp = decrypt<Smtp>(mail.smtp_secret, env.ENCRYPTION_KEY);
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 15000,
      socketTimeout: 30000,
    });
    try {
      const messageId = `<${mail.id}@scheduler.local>`;
      const result = await transport.sendMail({
        from: { name: mail.owner_name, address: mail.owner_email },
        envelope: { from: mail.sender_email, to: mail.recipient },
        to: mail.recipient,
        subject: mail.subject,
        text: mail.body,
        messageId,
      });
      await db.query(
        `UPDATE emails SET status='sent',sent_at=now(),message_id=$2,preview_url=$3,version=version+1 WHERE id=$1`,
        [mail.id, messageId, nodemailer.getTestMessageUrl(result) || null],
      );
    } catch (error) {
      const err = error as { responseCode?: number; code?: string };
      const definite = err.responseCode && err.responseCode >= 400;
      await db.query(
        `UPDATE emails SET status=$2,error=$3,version=version+1 WHERE id=$1`,
        [
          mail.id,
          definite ? "failed" : "uncertain",
          definite
            ? "SMTP rejected the message"
            : "SMTP outcome unknown; inspect Ethereal before any manual resend",
        ],
      );
    } finally {
      transport.close();
    }
  },
  { connection: redis, concurrency: env.WORKER_CONCURRENCY },
);

async function dispatch() {
  const { rows } = await db.query(
    `SELECT id,scheduled_at FROM emails WHERE status='scheduled' AND queued=false ORDER BY scheduled_at,id LIMIT 1000`,
  );
  await emailQueue.addBulk(
    rows.map((e) => ({
      name: "send",
      data: { emailId: e.id },
      opts: {
        jobId: e.id,
        delay: Math.max(0, new Date(e.scheduled_at).getTime() - Date.now()),
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    })),
  );
  if (rows.length)
    await db.query("UPDATE emails SET queued=true WHERE id=ANY($1::uuid[])", [
      rows.map((e) => e.id),
    ]);
  // Recover DB records after Redis data loss without re-sending completed attempts.
  const { rows: due } = await db.query(
    `SELECT id,scheduled_at FROM emails WHERE status='scheduled' AND queued=true AND scheduled_at<now() ORDER BY scheduled_at LIMIT 1000`,
  );
  for (const e of due) {
    const job = await emailQueue.getJob(e.id);
    if (!job) {
      await db.query("UPDATE emails SET queued=false WHERE id=$1", [e.id]);
    } else if ((await job.getState()) === "failed") {
      await job.retry();
    }
  }
  await db.query(
    `UPDATE emails SET status='uncertain',error='Worker stopped during SMTP; delivery outcome needs inspection',version=version+1 WHERE status='sending' AND attempted_at<now()-interval '5 minutes'`,
  );
}
async function indexing() {
  if (!(await search.indices.exists({ index }))) {
    try {
      await search.indices.create({
        index,
        mappings: {
          properties: {
            id: { type: "keyword" },
            user_id: { type: "keyword" },
            recipient: { type: "text" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduled_at: { type: "date" },
            sent_at: { type: "date" },
          },
        },
      });
    } catch (e) {
      if (
        (e as { meta?: { body?: { error?: { type?: string } } } }).meta?.body
          ?.error?.type !== "resource_already_exists_exception"
      )
        throw e;
    }
  }
  const { rows } = await db.query(
    "SELECT * FROM emails WHERE indexed_version<version ORDER BY scheduled_at LIMIT 500",
  );
  if (!rows.length) return;
  const result = await search.bulk({
    refresh: "wait_for",
    operations: rows.flatMap((e) => [
      {
        index: {
          _index: index,
          _id: e.id,
          version: Number(e.version),
          version_type: "external_gte",
        },
      },
      {
        id: e.id,
        user_id: e.user_id,
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
        status: e.status,
        scheduled_at: e.scheduled_at,
        sent_at: e.sent_at,
      },
    ]),
  });
  for (let i = 0; i < rows.length; i++)
    if (!result.items[i].index?.error)
      await db.query(
        "UPDATE emails SET indexed_version=GREATEST(indexed_version,$2) WHERE id=$1",
        [rows[i].id, rows[i].version],
      );
}
async function notifications() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT n.*,s.webhook_secret FROM notifications n JOIN slack_connections s ON s.user_id=n.user_id WHERE n.delivered_at IS NULL ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 20`,
    );
    for (const n of rows) {
      const webhook = decrypt<string>(n.webhook_secret, env.ENCRYPTION_KEY);
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: n.text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(`Slack delivery failed (${response.status})`);
      await client.query(
        "UPDATE notifications SET delivered_at=now() WHERE id=$1",
        [n.id],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
const maintenance = new Worker(
  "maintenance",
  async () => {
    await dispatch();
    await Promise.allSettled([
      indexing().catch((e) => {
        console.error("Indexing unavailable", e.message);
        throw e;
      }),
      notifications().catch((e) => {
        console.error("Slack unavailable", e.message);
        throw e;
      }),
    ]);
    await redis.set("worker-heartbeat", Date.now(), "EX", 60);
  },
  { connection: redis, concurrency: 1 },
);
await maintenanceQueue.upsertJobScheduler(
  "maintenance-every-5s",
  { every: 5000 },
  { name: "reconcile", data: {} },
);
worker.on("error", (e) => console.error("Worker error", e.message));
maintenance.on("error", (e) => console.error("Maintenance error", e.message));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await Promise.all([worker.close(), maintenance.close()]);
    await Promise.all([
      emailQueue.close(),
      maintenanceQueue.close(),
      db.end(),
      search.close(),
    ]);
    redis.disconnect();
    process.exit(0);
  });
