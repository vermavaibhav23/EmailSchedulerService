import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleSchema, plannedTimes } from "./validation.js";
import { encrypt, decrypt } from "./crypto.js";
test("1000 recipients get ordered, durable planned timestamps", () => {
  const times = plannedTimes(Date.UTC(2026, 8, 29), 1000, 2000);
  assert.equal(times.length, 1000);
  assert.equal(Date.parse(times[999]) - Date.parse(times[0]), 1998000);
  assert.ok(times.every((v, i) => i === 0 || v > times[i - 1]));
});
test("invalid recipients, fractional rates and header injection rejected", () => {
  const valid = {
    senderId: "9b6e3dab-c6ca-4a11-841b-77b64566d06a",
    recipients: ["lead@example.com"],
    subject: "Hi",
    body: "Hello",
    startAt: "2026-09-29T10:00:00Z",
    delayMs: 2000,
    hourlyLimit: 200,
  };
  assert.ok(scheduleSchema.safeParse(valid).success);
  for (const change of [
    { recipients: ["bad"] },
    { hourlyLimit: 1.5 },
    { delayMs: 0 },
    { subject: "Hi\r\nBcc: attacker@example.com" },
  ])
    assert.equal(
      scheduleSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});
test("SMTP and Slack secrets encrypted and authenticated", () => {
  const key = "ab".repeat(32);
  const secret = { pass: "private-password" };
  const encoded = encrypt(secret, key);
  assert.ok(!encoded.includes(secret.pass));
  assert.deepEqual(decrypt(encoded, key), secret);
  assert.throws(() => decrypt(encoded, "cd".repeat(32)));
});
