// The Zerodha login, kept as one of the agent's own records (they survive restarts and deploys, also hosted).
// The agent serves one account; its access token expires every morning (src/kite.ts).

import { randomBytes } from "node:crypto";
import type { Records, ToolContext } from "@flow-engineer/flow";
import { createSession, KiteLoginRequired, type Session } from "./kite.ts";

export const recordCollections = {
  kite_session: { people: ["person"] },
  kite_logins: {},
  kite_alert_seen: {},
};

// The routes (src/routes.ts) run outside a turn and, hosted, in the MCP server's module: buildAgent hands
// them the agent's records here.
let shared: Records | undefined;
export const useRecords = (records: Records) => {
  shared = records;
};
const store = (records?: Records) => {
  const found = records ?? shared;
  if (!found) throw new Error("The agent is not running here, so there is nowhere to keep the login.");
  return found;
};

const LOGIN_MINUTES = 15;

/** KITE_ALLOWED_PHONE (E.164), when set, is the only number that may use the Kite tools; anyone else who writes is refused. */
export function checkAllowed(context: Pick<ToolContext, "person">) {
  const phone = process.env.KITE_ALLOWED_PHONE?.trim();
  if (phone && context.person !== `phone:${phone}`) throw new Error("This agent is private. Only its owner can use the Zerodha tools.");
}

/** A one-time code in the login link; it comes back to the callback, so only a login asked for here is accepted. */
export async function startLogin(context: Pick<ToolContext, "person" | "records">): Promise<string> {
  checkAllowed(context);
  const state = randomBytes(18).toString("hex");
  await store(context.records).put("kite_logins", state, { person: context.person, at: Date.now() });
  return state;
}

/** The callback: trades the request_token for the access token and keeps it, with who asked for the login. */
export async function completeLogin(state: string, requestToken: string): Promise<string> {
  const records = store();
  const login = (await records.get("kite_logins", state)) as { person: string; at: number } | null;
  if (!login || Date.now() - login.at > LOGIN_MINUTES * 60_000) throw new Error("This login link expired or was already used. Ask the agent for a new one.");
  await records.delete("kite_logins", state);
  const session = await createSession(requestToken);
  await records.put("kite_session", "current", { person: login.person, ...session });
  return session.user_id;
}

export async function sessionFor(context: Pick<ToolContext, "person" | "records">): Promise<Session> {
  checkAllowed(context);
  const found = (await store(context.records).get("kite_session", "current")) as Session | null;
  if (!found) throw new KiteLoginRequired();
  return found;
}

/** Who signed in, for order updates: their person id (phone:+91...), or null. */
export async function signedInPerson(): Promise<string | null> {
  const found = (await store().get("kite_session", "current")) as { person?: string } | null;
  return found?.person ?? null;
}
