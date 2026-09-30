# Email Scheduler Service

TypeScript / Express + PostgreSQL + Redis / BullMQ + Elasticsearch, with a React dashboard modeled on the supplied [Outbox Labs Figma](https://www.figma.com/design/kOTwGlESjijCYnMgtHfvfU/Outbox-Labs-Assignment?node-id=59-4050). Implements the [assignment](https://sumptuous-word-80f.notion.site/Software-Development-Intern-Assignment-2bc1596f45e88080995cec1180a2bc60).

## Stage 1 — Railway infrastructure

All PostgreSQL, Redis, Elasticsearch and BullMQ worker services run on Railway only. Follow [docs/RAILWAY.md](docs/RAILWAY.md) to create the project, persistent infrastructure, API and worker. No local service instances are required.

Local compilation requires Node 22+ and npm:

```sh
npm ci
npm run build
npm test
```

## Stage 2 — Railway APIs and worker

Railway runs `npm run migrate` before deployment, `npm start` for the API and `npm run worker` in the separate worker service. Migrations use a PostgreSQL advisory lock and idempotent DDL. Keep stable random encryption/session keys and persistent Redis AOF with noeviction. Infrastructure stays on private networks.

Open the API's Railway public HTTPS domain. `/health/live` checks the API process. `/health/ready` checks PostgreSQL, Redis, Elasticsearch and worker heartbeat.

Create a Google OAuth web app with `<APP_URL>/auth/google/callback` as its redirect URI and configure its client ID/secret in Railway. Login exchanges a real authorization code, verifies Google userinfo and rotates the Redis session.

Create a Slack app with `incoming-webhook` scope and `<APP_URL>/integrations/slack/callback` as its redirect URI. Configure its client ID/secret in Railway. Connect Slack from the dashboard and select a test channel. The resulting webhook is encrypted server-side. Disconnect removes the stored connection and pending notifications; reconnect takes effect immediately. To uninstall the workspace authorization, revoke the app in Slack itself.

Use **Add Ethereal sender** in Compose to provision real fake-SMTP accounts. SMTP passwords stay encrypted server-side. Ethereal previews are linked from sent email details; no real recipient inboxes receive these emails.

All APIs require Google login. `/api/me` returns the CSRF token for `X-CSRF-Token` on mutations. Campaign creation also requires a stable `Idempotency-Key`.

| Method     | Route                                   | Purpose                                       |
| ---------- | --------------------------------------- | --------------------------------------------- |
| GET        | `/api/me`, `/api/settings`              | Session and configured limits                 |
| GET / POST | `/api/senders`, `/api/senders/ethereal` | List / provision senders                      |
| POST       | `/api/campaigns`                        | Persist and schedule a batch                  |
| GET        | `/api/emails?view=scheduled&q=&page=1`  | Scheduled/sent lists and Elasticsearch search |
| GET        | `/api/stats`, `/api/slack`              | Counts and Slack connection                   |
| DELETE     | `/api/slack`                            | Disconnect notifications                      |
| POST       | `/api/logout`                           | Destroy session                               |
| GET        | `/admin/queues`                         | Live Bull Board for allowlisted ADMIN_EMAILS  |

Example campaign body (use a future ISO timestamp):

```json
{
  "senderId": "<sender UUID>",
  "recipients": ["lead@example.com"],
  "subject": "Hello",
  "body": "Welcome!",
  "startAt": "2026-12-01T10:00:00Z",
  "delayMs": 2000,
  "hourlyLimit": 200
}
```

## Stage 3 — UI

The production API serves the Vite build from the same origin; this avoids CORS and cross-origin session issues. Local Vite can inspect frontend rendering without starting infrastructure; live integration testing uses the Railway domain.

Includes Google login, avatar/name/email, logout, scheduled/sent sections, search, pagination, 5-second refresh, Compose, CSV/text lead detection and deduplication, start time, delay, hourly cap, sender provisioning, Slack connect/disconnect, email details, Ethereal links, loading/empty/error states and responsive layouts. Times are displayed in the viewer's timezone and stored in UTC. The composer sends plain text; it does not pretend to support rich-text formatting from the reference design.

## Reliability and load behavior

1. A campaign transaction writes the campaign and all recipient rows. A user-scoped idempotency key and request hash prevent duplicate API submissions and reject reuse for different content.
2. A BullMQ interval job every 5 seconds dispatches unqueued DB rows into delayed jobs with deterministic email UUIDs. This acts as a transactional outbox: a crash between queue insertion and DB acknowledgement can safely repeat insertion. No cron library, OS cron or cron expressions are used.
3. Workers use configurable concurrency (default 5). A Redis Lua gate uses Redis TIME and atomic sender counters to enforce the sender cap across all instances and a minimum **2 seconds between attempts per sender** by default. Campaign delay and hourly limit may tighten those limits. Separate senders can run concurrently.
4. The UTC hour counter includes attempted sends, conservatively including failures. When exhausted, jobs move to the next hour through `moveToDelayed` / `DelayedError`, without consuming retries or failing the email. Spacing delays work the same way. Jobs retain identity; ordering is approximate when campaigns compete for the same sender.
5. When the final slot is reserved, the worker durably records a notification; the next maintenance tick makes a real HTTPS POST to the connected Slack webhook. At most one notification record exists per sender/hour. Delivery latency is normally under 5 seconds plus network time. A crash after Slack accepts the message but before DB commit can duplicate a notification; it cannot duplicate an email.
6. Workers atomically change an email from scheduled to sending before SMTP. Other workers and restarted jobs skip claimed rows. A confirmed send records preview and sent time. A definite SMTP rejection records failed. Network failures or interrupted sends become uncertain and are never automatically resent. Stale sending rows become uncertain after 5 minutes.
7. Elasticsearch indexing uses DB version counters and external versions to prevent old updates overwriting new state. Failures keep rows pending for retry. Search is eventually consistent and tenant-filtered; unfiltered lists work while Elasticsearch is down. Search is capped at 10,000 hits and the response indicates truncation.

For 1000+ simultaneous emails, the worker queues rather than spawns unbounded processes; dispatch and indexing use bounded batches. Sender gates spread work and defer overflow. Database recovery re-adds missing overdue jobs after Redis loss. **Redis AOF durability is required for rate counters**; after complete Redis data loss, queued DB emails recover but the current hour's rate budget cannot be reconstructed by this implementation. Keep persistent Redis storage and backups.

**SMTP cannot guarantee exactly-once delivery across an ambiguous network failure.** This implementation chooses duplicate prevention over automatic recovery of uncertain sends. Inspect the deterministic Message-ID and Ethereal inbox before manually creating a replacement campaign. It does not claim impossible exactly-once SMTP semantics.

## Railway deployment

Follow [docs/RAILWAY.md](docs/RAILWAY.md) in order: PostgreSQL / Redis / Elasticsearch, API and worker, OAuth configuration, then live verification. BullMQ is a Node library inside the worker service; it does not require an independent BullMQ database or managed instance. Both services build this repository's Dockerfile. Set service commands directly in Railway Settings; legacy TOML files are reference configurations.

## Validation and demo

```sh
npm test
npm run build
```

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the real-service restart, rate-limit, Slack and multi-tenant checks. Compilation and unit tests do not establish a live deployment or a working OAuth integration; those require account credentials and running infrastructure.

For a demo under 5 minutes: log in; connect Slack; create two senders; schedule three emails with a sender hourly cap of 2; show Scheduled and Sent with Ethereal previews; show the Slack limit message and delayed third job; stop/restart the worker before a future scheduled email; show its eventual send and unchanged completed rows in Bull Board.

Submission sharing and the submission form are separate user actions; no collaborator access or application submission is performed automatically.

## Direct email login

The login page supports email/password login and account creation alongside Google. Choose **Create an account** on first use; passwords require 12–128 characters and are stored as salted scrypt hashes. Auth uses the same Redis session/CSRF flow, rotates the session on sign-in and limits attempts to 20 per IP per 15 minutes. `/auth/email` requires same-origin JSON POSTs. Password identities are separate from Google identities and are never automatically linked by email. Email ownership is not verified in this basic flow, so password accounts cannot obtain admin access through ADMIN_EMAILS. Email verification, password recovery and account linking are future extensions.
