# Live verification checklist

Run against deployed Railway services only (no local database, Redis or worker instances), real Google/Slack apps and Ethereal accounts. Keep test recipients in fake SMTP.

1. Login via Google; confirm name, email, avatar and logout. Mutation without CSRF token returns 403; unauthenticated API returns 401.
2. Create two Ethereal senders. Schedule a batch with a future start, 2-second spacing and hourly cap 2. Confirm DB rows, delayed jobs and dashboard counts.
3. Replay identical campaign body and Idempotency-Key; expect same campaign ID. Change the body with the same key; expect 409. Try another user's sender ID; expect 404.
4. Connect Slack using real OAuth and select a test channel. Send two emails. Confirm a live Slack message within a maintenance interval and the third email delayed to the next UTC hour. Disconnect and hit another sender's cap; no crash or message. Reconnect and hit a subsequent hour's cap; notification resumes.
5. Stop the worker before a future email is due. Restart after its due time. Confirm one send and an Ethereal preview. Restart again; confirm sent emails are not sent twice.
6. Run two workers against the same Redis/DB. Schedule 1000 fake recipients (prefer a low cap to avoid unnecessary SMTP load). Confirm sender spacing and shared hour count; distinct sender queues may progress in parallel. No dropped jobs or unbounded process creation.
7. Interrupt a worker during SMTP. Confirm stale sending becomes uncertain after 5 minutes and cannot be blindly retried. Inspect Ethereal Message-ID before any manual replacement.
8. Stop Redis briefly; schedule only if the session store is reachable. A committed campaign remains in PostgreSQL even if queue dispatch fails. Restart Redis and worker; confirm queued recovery. Do not flush production Redis; counters require its durable storage.
9. Stop Elasticsearch, send an email and confirm SMTP still works. Search returns a clear unavailable message. Restart Elasticsearch; pending rows index on the next tick. Verify scheduled and sent search, including isolation between two users.
10. Open Bull Board as an allowlisted admin; verify live delayed/active/completed state. Other logged-in users must receive 403.
11. In UI check file parsing, duplicates, empty/invalid uploads, recipient cap, date validation, pagination, loading, errors and narrow-screen layouts. Verify browser network responses contain no SMTP passwords or Slack webhook.
