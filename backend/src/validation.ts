import { z } from "zod";
export const scheduleSchema = z
  .object({
    senderId: z.string().uuid(),
    recipients: z.array(z.string().email().max(320)).min(1).max(10000),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n]/.test(v), "Subject cannot contain newlines"),
    body: z.string().min(1).max(100000),
    startAt: z.string().datetime({ offset: true }),
    delayMs: z.number().int().min(1).max(86400000),
    hourlyLimit: z.number().int().min(1).max(100000),
  })
  .strict();
export function plannedTimes(start: number, count: number, delay: number) {
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * delay).toISOString(),
  );
}
