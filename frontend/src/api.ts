export type User = { id: string; name: string; email: string; avatar: string };
export type Sender = {
  id: string;
  name: string;
  email: string;
  hourly_limit: number;
};
export type Email = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  preview_url: string | null;
  error: string | null;
};
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
