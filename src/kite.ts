// A small Kite Connect v3 client over fetch (https://kite.trade/docs/connect/v3/), for one Zerodha account: the
// one that owns the Kite app in KITE_API_KEY and KITE_API_SECRET. Its access token expires every morning, so it
// is kept (src/sessions.ts) and passed to `kite`, and renewed by the person's login (loginUrl, then /zerodha/callback).

import { createHash, timingSafeEqual } from "node:crypto";

const BASE = "https://api.kite.trade";
export interface Session {
  access_token: string;
  user_id: string;
  /** IST calendar date the token was made; Kite expires it at about 6 AM the next morning. */
  day: string;
}

const istDay = (at = new Date()) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

function keys() {
  const apiKey = process.env.KITE_API_KEY?.trim();
  const apiSecret = process.env.KITE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) throw new Error("KITE_API_KEY and KITE_API_SECRET are not set in .env");
  return { apiKey, apiSecret };
}

/** `state` comes back to the redirect URL as ?state=, so the callback knows the login was asked for here. */
export const loginUrl = (state: string) => `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(keys().apiKey)}&redirect_params=${encodeURIComponent(`state=${state}`)}`;

/** Kite ends the day's token at about 6 AM IST; a token from an earlier IST day is expired. */
export const isLive = (session: Session) => session.day === istDay(new Date(Date.now() - 6 * 3_600_000));

/** Trades the request_token Zerodha sends to the redirect URL for an access token. */
export async function createSession(requestToken: string): Promise<Session> {
  const { apiKey, apiSecret } = keys();
  const checksum = createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");
  const response = await fetch(`${BASE}/session/token`, {
    method: "POST",
    headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }),
  });
  const body = (await response.json()) as { status: string; message?: string; data?: { access_token: string; user_id: string } };
  if (body.status !== "success" || !body.data) throw new Error(body.message ?? `Kite login failed (${response.status})`);
  return { access_token: body.data.access_token, user_id: body.data.user_id, day: istDay(new Date(Date.now() - 6 * 3_600_000)) };
}

export class KiteLoginRequired extends Error {
  constructor() {
    super("Kite login needed today. Call kite_login_link and send the person the link.");
  }
}

/** One Kite API call. Throws KiteLoginRequired when there is no live token. */
export async function kite<T>(session: Session | null, method: "GET" | "POST" | "PUT" | "DELETE", path: string, form?: Record<string, string | number>, json?: unknown): Promise<T> {
  const { apiKey } = keys();
  if (!session || !isLive(session)) throw new KiteLoginRequired();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${apiKey}:${session.access_token}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : form ? new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])) : undefined,
  });
  const body = (await response.json()) as { status: string; message?: string; error_type?: string; data: T };
  if (body.error_type === "TokenException") throw new KiteLoginRequired();
  if (body.status !== "success") throw new Error(body.message ?? `Kite error (${response.status})`);
  return body.data;
}

/** Whether a postback's checksum, SHA-256 of order_id + order_timestamp + api_secret, is Kite's. Throws when the app is not set up. */
export function postbackValid(orderId: string, orderTimestamp: string, checksum: string): boolean {
  const expected = Buffer.from(createHash("sha256").update(orderId + orderTimestamp + keys().apiSecret).digest("hex"));
  const given = Buffer.from(String(checksum));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
