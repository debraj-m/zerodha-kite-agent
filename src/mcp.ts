// The agent's tools and skills as an MCP server, for Claude, ChatGPT or any MCP host: `npm run mcp`.
// The same tools the chat agent uses; no model key needed, since the host brings its own model.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { mcpServer } from "@flow-engineer/flow/mcp";
import { choosePort } from "@flow-engineer/flow";
import { kiteHostedRoutes } from "./routes.ts";
import { displayName, name, serverEnv } from "./name.ts";
import { tools } from "./tools.ts";

export const mcp = mcpServer({
  name,
  version: "1.0.0",
  tools,
  dir: fileURLToPath(new URL("../agent", import.meta.url)),
  // One account (the owner's own). Hosted, /mcp is public, so it needs the bearer token MCP_TOKEN (a secret,
  // 32+ characters); with none set it answers only on localhost. The same `auth` carries Zerodha's two
  // URLs (src/routes.ts), which Flow's hosting serves because they are this server's paths. For other
  // users, replace `verify` (the flow-framework-auth skill).
  auth: {
    issuer: process.env.MCP_ISSUER ?? "https://flow.engineer",
    verify: (token, request) => {
      const secret = process.env.MCP_TOKEN;
      const ok = secret
        ? secret.length >= 32 && token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))
        : ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
      return ok ? { key: "owner" } : null;
    },
    routes: kiteHostedRoutes,
  },
});

// Run as `npm run mcp`; Flow's hosting imports `mcp` and serves it beside the agent.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // MCP_PORT, else 8790 or the next free port above it.
  let port: number;
  try {
    const chosen = await choosePort("MCP_PORT", 8790, { command: "npm run mcp" });
    port = chosen.port;
    if (chosen.note) console.log(`${chosen.note} The CLI then needs ${serverEnv}=http://127.0.0.1:${port}/mcp.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  createServer((req, res) => void mcp.node(req, res))
    .once("error", (error) => {
      console.error(`${error.message}. Run: MCP_PORT=<port> npm run mcp`);
      process.exit(1);
    })
    .listen(port, "127.0.0.1", () => {
      console.log(`${displayName}'s MCP server: http://127.0.0.1:${port}/mcp`);
      console.log(`Try it in Claude Code: claude mcp add --transport http ${name} http://127.0.0.1:${port}/mcp`);
    });
}
