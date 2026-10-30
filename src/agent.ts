// Builds the agent. The playground (main.ts) and the tests build it the same way; tests pass their own
// model, events and (simulated) tools.

import { fileURLToPath } from "node:url";
import { createAgent, customUI, flowModel, openAICompatible, sms, whatsapp, type Channel, type EventSink, type HostOptions, type Model, type Tool } from "@flow-engineer/flow";
import { kiteRoutes, setOrderNotifier, type OnOrderUpdate } from "./routes.ts";
import { alertWatcher } from "./alerts.ts";
import { recordCollections, signedInPerson, useRecords } from "./sessions.ts";
import { tools } from "./tools.ts";

export interface BuildOptions {
  model?: Model;
  events?: EventSink[];
  tools?: Tool[];
  /** Channels that are connected, such as Telegram through Flow Messaging (main.ts adds them when .env has its key); one named whatsapp replaces the unconnected one. */
  channels?: Channel[];
  /** What the place running it supplies (Flow's hosting: its store and Flow Messaging; Cloudflare: files and a database), passed to createAgent as it is. */
  host?: HostOptions;
}

export { tools };

// WhatsApp, SMS and web chat are not connected yet, so every provider refuses to send. Test
// people write from the playground, and replies to them go back there, never through these.
const notConnected = async () => {
  throw new Error("not connected yet: only test people in the playground reach the agent for now");
};
const provider = { sendMessage: notConnected, react: notConnected, typing: notConnected, markRead: notConnected, status: notConnected };

// A verified order update goes to the person who signed in to Zerodha, on WhatsApp. WhatsApp lets the agent write first only inside 24 hours of that person's
// last message, which the morning login chat normally keeps open.
const NOTIFY = new Set(["OPEN", "COMPLETE", "REJECTED", "CANCELLED"]);

export function buildAgent(options: BuildOptions = {}) {
  const connected = options.channels ?? [];
  // Hosted on Flow Messaging, its channels are the real ones (createAgent adds them from host.messaging).
  const unconnected = options.host?.messaging ? [] : [whatsapp(provider), sms(provider), customUI("web", provider)].filter((c) => !connected.some((k) => k.name === c.name));
  const onOrderUpdate: OnOrderUpdate = async (u) => {
    if (!NOTIFY.has(u.status)) return;
    const person = await signedInPerson();
    if (!person?.startsWith("phone:")) return;
    const phone = person.slice("phone:".length);
    const filled = u.status === "COMPLETE" || u.filled_quantity ? `, filled ${u.filled_quantity}/${u.quantity}${u.average_price ? ` at ₹${u.average_price}` : ""}` : "";
    try {
      const result = await agent.nudge({
        to: { channel: "whatsapp", address: phone },
        text: `Order ${u.status}: ${u.transaction_type} ${u.quantity} ${u.tradingsymbol}${filled}. Order id ${u.order_id}.`,
        idempotencyKey: `kite-order:${u.order_id}:${u.status}:${u.filled_quantity}`,
        respectQuietHours: false,
      });
      if (result.status !== "sent") console.warn(`Order ${u.order_id} update not sent to the owner: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
    } catch (error) {
      console.warn(`Order ${u.order_id} update not sent to the owner: ${(error as Error).message}`);
    }
  };
  const agent = createAgent({
    dir: fileURLToPath(new URL("../agent", import.meta.url)),
    host: options.host,
    // Flow's hosting fills OPENROUTER_API_KEY and the other provider keys with values that are refused, and those win
    // over FLOW_KEY, so hosted it uses Flow's model with FLOW_KEY alone. Locally, a key the owner typed still wins.
    model: options.model ?? (options.host && process.env.FLOW_KEY ? flowModel() : openAICompatible()),
    tools: options.tools ?? tools,
    events: options.events ?? [],
    channels: [...unconnected, ...connected],
    testPeople: [{ name: "Owner", phone: "+15555550101" }],
    timeZone: "Asia/Kolkata",
    // The Redirect URL and Postback URL entered in the Kite Connect app (src/routes.ts).
    routes: kiteRoutes(onOrderUpdate),
    records: recordCollections,
    // WhatsApp message when a Zerodha price alert fires (src/alerts.ts).
    onTick: alertWatcher(() => agent),
  });
  useRecords(agent.records);
  setOrderNotifier(onOrderUpdate);
  return agent;
}
