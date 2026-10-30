// The agent in the playground: `npm start`, then open the printed link and pick a test person. With
// FLOW_MESSAGING_KEY in .env (`npx @flow-engineer/flow link` puts it there), it is on Telegram
// too (and WhatsApp and iMessage when .env names their senders), through Flow Messaging's event
// stream: an outbound connection, so no public URL or tunnel. It listens on PORT, else 8788 or the
// next free port above it.

import { createServer } from "node:http";
import { choosePort, markRunning } from "@flow-engineer/flow";
import { flowMessaging } from "@flow-engineer/flow/flow-messaging";
import { simulators } from "@flow-engineer/flow/simulators";
import { buildAgent } from "./agent.ts";
import { channelNames } from "./channels.ts";
import { displayName } from "./name.ts";

const play = simulators({ title: displayName });
const fm = process.env.FLOW_MESSAGING_KEY ? flowMessaging() : undefined;
// Telegram, plus WhatsApp and iMessage when .env names their senders.
const channels = fm ? fm.channels() : [];
let agent: ReturnType<typeof buildAgent>;
try {
  agent = buildAgent({ events: [play.events], channels });
} catch (error) {
  console.error((error as Error).message); // such as no model key in .env
  process.exit(1);
}
let url: string;
try {
  const { port, note } = await choosePort("PORT", 8788, { command: "npm start" });
  if (note) console.log(note);
  ({ url } = await play.listen(agent, port));
} catch (error) {
  console.error((error as Error).message); // such as the port PORT names being in use
  process.exit(1);
}
const port = Number(new URL(url).port);
// `npx @flow-engineer/flow link` reads it (.flow/running.json) to say whether to start or restart this.
markRunning(url);
console.log(`${displayName}'s playground: ${url}/`);
console.log(`Every channel side by side: ${url}/person`);
// The playground does not serve the agent's `routes`, so Zerodha's two URLs (src/routes.ts) get their own
// port here. Zerodha needs a public https address for them: this is what a tunnel or the deploy points at.
try {
  const { port: routesPort } = await choosePort("ROUTES_PORT", port + 2, { command: "npm start" });
  createServer(async (req, res) => {
    try {
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Response(req as never).arrayBuffer();
      const response = await agent.fetch(new Request(`http://127.0.0.1:${routesPort}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(`${req.method} ${req.url}: ${(error as Error).message}`);
      res.writeHead(500).end("error");
    }
  }).listen(routesPort, "127.0.0.1");
  console.log(`Zerodha routes: http://127.0.0.1:${routesPort}/zerodha/callback and /zerodha/postback`);
} catch (error) {
  console.error((error as Error).message);
}
if (fm) {
  // Events sent while it was not running come when it starts again (.flow/ keeps the last one handled).
  const live = fm.start(agent, { cursorFile: ".flow/flow-messaging-cursor", port: port + 1 });
  console.log(`On ${channelNames(channels)} through Flow Messaging (${live.mode}). The phone link: npx @flow-engineer/flow link`);
  live.stopped.then((why) => console.error(`Flow Messaging stopped: ${why.message} Then: npx @flow-engineer/flow setup`));
}
