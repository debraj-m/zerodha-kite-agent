// WhatsApp messages for Zerodha price alerts. Kite tells the Kite app when an alert fires and has no webhook for
// it, so the agent's own clock (createAgent `onTick`) looks at the alerts every couple of minutes while the
// person is signed in, and messages them when an alert's trigger count has gone up.

import type { Records } from "@flow-engineer/flow";
import { isLive, kite, type Session } from "./kite.ts";

const EVERY_MS = 2 * 60_000;

interface AlertRow {
  uuid: string;
  name: string;
  lhs_exchange: string;
  lhs_tradingsymbol: string;
  operator: string;
  rhs_constant: number;
  alert_count: number;
}

interface Watched {
  records: Records;
  nudge(input: { to: { channel: string; address: string }; text: string; idempotencyKey: string; respectQuietHours: boolean }): Promise<{ status: string; reason?: string }>;
}

export function alertWatcher(agent: () => Watched) {
  let last = 0;
  let running = false;
  return async (now: number) => {
    if (running || now - last < EVERY_MS) return;
    running = true;
    last = now;
    try {
      const watched = agent();
      const records = watched.records;
      const session = (await records.get("kite_session", "current")) as (Session & { person?: string }) | null;
      if (!session || !isLive(session) || !session.person?.startsWith("phone:")) return;
      const address = session.person.slice("phone:".length);
      const alerts = await kite<AlertRow[]>(session, "GET", "/alerts");
      for (const a of alerts) {
        const seen = (await records.get("kite_alert_seen", a.uuid)) as { count: number } | null;
        // An alert seen for the first time starts from where it is, so old triggers are not announced.
        if (!seen || a.alert_count <= seen.count) {
          if (!seen) await records.put("kite_alert_seen", a.uuid, { count: a.alert_count });
          continue;
        }
        await records.put("kite_alert_seen", a.uuid, { count: a.alert_count });
        const result = await watched.nudge({
          to: { channel: "whatsapp", address },
          text: `🔔 *${a.lhs_tradingsymbol}* alert hit: price ${a.operator} ₹${a.rhs_constant.toLocaleString("en-IN")}.`,
          idempotencyKey: `kite-alert:${a.uuid}:${a.alert_count}`,
          respectQuietHours: false,
        });
        if (result.status !== "sent") console.warn(`Alert ${a.uuid} not sent: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
      }
    } catch (error) {
      // Not signed in today, or Kite is busy: try again at the next check.
      console.warn(`Alert check skipped: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
}
