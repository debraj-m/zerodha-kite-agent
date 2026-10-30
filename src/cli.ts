#!/usr/bin/env node
// The Zerodha Kite agent's command line, over its MCP server (npm run mcp in another terminal):
//   npm run cli -- funds
//   npm run cli -- holdings --json
//   npm run cli -- order list
// (npm reads flags before `--` as its own: keep the `--`.) Installed, it is a command of its own,
// named after the agent (src/name.ts). Every tool is already a command under its own name; this
// file adds the words and arguments.

import { fileURLToPath } from "node:url";
import { defineCli, runCli } from "@flow-engineer/flow/cli";
import { name, serverEnv } from "./name.ts";

export const cli = defineCli({
  name,
  server: process.env[serverEnv] ?? "http://127.0.0.1:8790/mcp",
  description: "Your Zerodha account: funds, holdings, positions and orders",
  groups: { order: "List, place and cancel orders" },
  commands: {
    login: { tool: "kite_login_link" },
    funds: { tool: "kite_funds" },
    holdings: { tool: "kite_holdings" },
    positions: { tool: "kite_positions" },
    "order list": { tool: "kite_orders", examples: [`${name} order list`] },
    "order place": { tool: "kite_place_order", examples: [`${name} order place --confirmed true --exchange NSE --tradingsymbol INFY --transaction_type BUY --quantity 1 --order_type LIMIT --product CNC --price 1500`] },
    "order cancel": { tool: "kite_cancel_order", args: ["order_id"], examples: [`${name} order cancel 240101000000001 --confirmed true`] },
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await runCli(cli, process.argv.slice(2)));
