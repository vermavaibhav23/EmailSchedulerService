import { Router, type RequestHandler } from "express";
import { randomBytes, randomUUID } from "node:crypto";
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
  if (!state || req.session.oauthState !== state)
    throw new Error("Invalid OAuth state");
  const raw = await redis.getdel(`oauth:${state}`);
  delete req.session.oauthState;
  if (!raw) throw new Error("Expired OAuth state");
  const data = JSON.parse(raw);
  if (
    data.provider !== provider ||
    data.userId !== (req.session.userId || null)
  )
    throw new Error("OAuth session mismatch");
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
