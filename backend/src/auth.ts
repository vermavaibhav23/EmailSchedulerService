import { Router, type RequestHandler } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./password.js";
import { db, redis } from "./infra.js";
import { env } from "./config.js";
import { encrypt } from "./crypto.js";
declare module "express-session" {
  interface SessionData {
    userId: string;
    csrf: string;
    oauthState: string;
  }
}
export const authRequired: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Please sign in" });
    return;
  }
  next();
};
export const csrfRequired: RequestHandler = (req, res, next) => {
  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    (!req.session.csrf || req.get("x-csrf-token") !== req.session.csrf)
  ) {
    res.status(403).json({ error: "Invalid request token" });
    return;
  }
  next();
};
export const auth = Router();
export class OAuthRequestError extends Error {}
const emailAuthSchema = z.object({
  mode: z.enum(["login", "register"]),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters").max(128),
  name: z.string().trim().min(1).max(100).optional(),
});
// Equal-cost comparison for unknown accounts; no account linking by unverified email.
const dummyPasswordHash = await hashPassword(randomBytes(32).toString("hex"));
auth.post("/auth/email", async (req, res, next) => {
  try {
    if (req.get("origin") !== new URL(env.APP_URL).origin || !req.is("application/json")) {
      res.status(403).json({ error: "Start sign-in from this app." });
      return;
    }
    const data = emailAuthSchema.parse(req.body);
    const ip = createHash("sha256").update(req.ip || "unknown").digest("hex");
    const attempts = await redis.eval(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n`, 1, `email-auth:${ip}`) as number;
    if (attempts > 20) {
      res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
      return;
    }
    let userId: string;
    if (data.mode === "register") {
      const passwordHash = await hashPassword(data.password);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        userId = randomUUID();
        await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [userId, data.email, data.name || data.email.split("@")[0]]);
        await client.query("INSERT INTO email_credentials(user_id,email,password_hash) VALUES($1,$2,$3)", [userId, data.email, passwordHash]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505") {
          res.status(409).json({ error: "An email account already exists. Choose Log in." });
          return;
        }
        throw error;
      } finally { client.release(); }
    } else {
      const { rows: [account] } = await db.query("SELECT user_id,password_hash FROM email_credentials WHERE email=$1", [data.email]);
      const valid = await verifyPassword(data.password, account?.password_hash || dummyPasswordHash);
      if (!account || !valid) {
        res.status(401).json({ error: "Email or password is incorrect." });
        return;
      }
      userId = account.user_id;
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = userId;
      req.session.csrf = randomBytes(32).toString("hex");
      req.session.save((error) => error ? next(error) : res.json({ status: "signed_in" }));
    });
  } catch (error) { next(error); }
});
const restartOAuth = () => new OAuthRequestError(
  "This login or connection attempt is missing, expired, or belongs to another browser session. Return to the app and start again using Login with Google or Connect Slack. Keep the same browser open and allow cookies.",
);
async function oauthState(
  req: Parameters<RequestHandler>[0],
  provider: string,
) {
  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;
  await redis.set(
    `oauth:${state}`,
    JSON.stringify({ provider, userId: req.session.userId || null }),
    "EX",
    600,
  );
  return state;
}
async function consume(req: Parameters<RequestHandler>[0], provider: string) {
  const state = String(req.query.state || "");
  if (typeof req.query.state !== "string" || !state || req.session.oauthState !== state)
    throw restartOAuth();
  const raw = await redis.getdel(`oauth:${state}`);
  delete req.session.oauthState;
  if (!raw) throw restartOAuth();
  const data = JSON.parse(raw);
  if (
    data.provider !== provider ||
    data.userId !== (req.session.userId || null)
  )
    throw restartOAuth();
  return data;
}
auth.get("/auth/google", async (req, res, next) => {
  try {
    if (!env.GOOGLE_CLIENT_ID) {
      res
        .status(503)
        .json({ error: "Google OAuth credentials are not configured" });
      return;
    }
    const state = await oauthState(req, "google");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${env.APP_URL}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
    }).toString();
    req.session.save((err) => (err ? next(err) : res.redirect(url.toString())));
  } catch (e) {
    next(e);
  }
});
auth.get("/auth/google/callback", async (req, res, next) => {
  try {
    await consume(req, "google");
    if (req.query.error || typeof req.query.code !== "string" || !req.query.code)
      throw new OAuthRequestError("Google sign-in was not completed. Return to the app and choose Login with Google again.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code: String(req.query.code || ""),
        grant_type: "authorization_code",
        redirect_uri: `${env.APP_URL}/auth/google/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token)
      throw new Error("Google token exchange failed");
    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    const p = (await profileResponse.json()) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture: string;
    };
    if (!profileResponse.ok || !p.sub || !p.email_verified)
      throw new Error("Google account email must be verified");
    const {
      rows: [user],
    } = await db.query(
      `INSERT INTO users(id,google_id,email,name,avatar) VALUES($1,$2,$3,$4,$5) ON CONFLICT(google_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,avatar=EXCLUDED.avatar RETURNING id`,
      [randomUUID(), p.sub, p.email, p.name, p.picture],
    );
    req.session.regenerate((err) => {
      if (err) {
        next(err);
        return;
      }
      req.session.userId = user.id;
      req.session.csrf = randomBytes(32).toString("hex");
      req.session.save((err) => (err ? next(err) : res.redirect("/")));
    });
  } catch (e) {
    next(e);
  }
});
auth.get(
  "/integrations/slack/connect",
  authRequired,
  async (req, res, next) => {
    try {
      if (!env.SLACK_CLIENT_ID) {
        res
          .status(503)
          .json({ error: "Slack OAuth credentials are not configured" });
        return;
      }
      const state = await oauthState(req, "slack");
      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.search = new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        scope: "incoming-webhook",
        redirect_uri: `${env.APP_URL}/integrations/slack/callback`,
        state,
      }).toString();
      req.session.save((err) =>
        err ? next(err) : res.redirect(url.toString()),
      );
    } catch (e) {
      next(e);
    }
  },
);
auth.get(
  "/integrations/slack/callback",
  authRequired,
  async (req, res, next) => {
    try {
      await consume(req, "slack");
      if (req.query.error || typeof req.query.code !== "string" || !req.query.code)
        throw new OAuthRequestError("Slack authorization was not completed. Return to the app and choose Connect Slack again.");
      const response = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        body: new URLSearchParams({
          client_id: env.SLACK_CLIENT_ID,
          client_secret: env.SLACK_CLIENT_SECRET,
          code: String(req.query.code || ""),
          redirect_uri: `${env.APP_URL}/integrations/slack/callback`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await response.json()) as {
        ok: boolean;
        team: { name: string };
        incoming_webhook: { url: string; channel: string };
      };
      if (!response.ok || !data.ok || !data.incoming_webhook)
        throw new Error("Slack connection failed");
      const webhook = new URL(data.incoming_webhook.url);
      if (
        webhook.protocol !== "https:" ||
        webhook.hostname !== "hooks.slack.com"
      )
        throw new Error("Invalid Slack webhook");
      await db.query(
        `INSERT INTO slack_connections(user_id,team_name,channel_name,webhook_secret) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET team_name=EXCLUDED.team_name,channel_name=EXCLUDED.channel_name,webhook_secret=EXCLUDED.webhook_secret,connected_at=now()`,
        [
          req.session.userId,
          data.team.name,
          data.incoming_webhook.channel,
          encrypt(webhook.toString(), env.ENCRYPTION_KEY),
        ],
      );
      res.redirect("/?slack=connected");
    } catch (e) {
      next(e);
    }
  },
);
