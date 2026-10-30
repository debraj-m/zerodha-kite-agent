# Zerodha Kite agent

Operate **your own** Zerodha account from WhatsApp. Text it "Morning" and get your funds, holdings, P&L and
orders in one message, set price alerts that ping you back on WhatsApp, and preview what an order would cost
before you place it. The same tools are also served as an MCP server and a CLI.

Built on [Flow Framework](https://github.com/flow-engineer/flow) (Apache-2.0) and Zerodha's
[Kite Connect](https://kite.trade/docs/connect/v3/) API.

> **Not affiliated with Zerodha. Not investment advice.** This is a personal tool. It gives no stock tips or
> predictions, by design. You are responsible for anything it does on your account. Read [SECURITY.md](SECURITY.md).

## What it does

| | |
| --- | --- |
| Read | funds and margin, holdings (value, P&L, day change), positions, today's orders and an order's history |
| Calculate | exact "x% below/above this price" levels, rounded to the 0.05 tick (`kite_price_level`) |
| Preview | margin and full charges (brokerage, STT, GST, stamp duty, fees) for an order you are only considering (`kite_order_cost`) |
| Alerts | create, list and delete Kite price alerts; a WhatsApp message when one fires |
| GTT | list, create and delete good-till-triggered orders, with a read-back and a confirm step |
| Orders | place and cancel orders, with a confirm step |
| Messages | formatted WhatsApp replies; WhatsApp updates for order fills, rejections and cancellations |

**Safe by default:** placing orders, GTT changes and cancels are **off** until `KITE_ORDERS_ENABLED=1`, and are
capped by `KITE_MAX_QUANTITY` (10) and `KITE_MAX_ORDER_VALUE` (₹10,000). Orders need `confirmed: true`, which the
agent sends only after you say yes to the exact order read back to you.

## One account, on purpose

A free Kite **Personal** app only lets the account that owns it sign in, and Zerodha says it has not authorized
anyone to trade on behalf of others. So this agent serves **one person's own account**. It does not manage
other people's accounts or store anyone else's keys, and you should not turn it into a service that does without
reading Zerodha's terms and the SEBI rules that apply to you.

## Setup

You need Node 22.18+, a Zerodha account, and a [Kite Connect app](https://developers.kite.trade/apps)
(type **Personal** is free).

```sh
npm install
cp .env.example .env            # then fill in KITE_API_KEY and KITE_API_SECRET yourself
npx @flow-engineer/flow link --channel whatsapp   # signs in to Flow, writes FLOW_KEY and the messaging keys
npm start                       # playground, and WhatsApp through Flow Messaging
```

In your Kite app set:

- **Redirect URL:** `https://<your-address>/zerodha/callback`
- **Postback URL:** `https://<your-address>/zerodha/postback` (optional; for order-update messages)

Zerodha needs a public https address for both. Locally, `npm start` serves them on port 8790; use a tunnel, or
deploy with `npx @flow-engineer/flow deploy` and use the address it prints.

Each morning Zerodha ends the login (about 6 AM IST). Ask the agent for "my Zerodha login link", sign in with
your password and 2FA, and carry on. Nothing can do that sign-in for you.

## Configuration (`.env`)

| Variable | Purpose |
| --- | --- |
| `KITE_API_KEY`, `KITE_API_SECRET` | your Kite Connect app. Never commit them. |
| `KITE_ORDERS_ENABLED` | `1` switches on orders and GTT changes. Default off. |
| `KITE_MAX_QUANTITY`, `KITE_MAX_ORDER_VALUE` | per-order caps (10 and ₹10,000) |
| `KITE_ALLOWED_PHONE` | the only WhatsApp number (E.164) allowed to use the Zerodha tools. **Set it.** |
| `FLOW_KEY` | the model key `link` writes (Flow's trial credit); or your own `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` |
| `MCP_TOKEN` | bearer token (32+ chars) for the MCP endpoint when deployed |

## Tests

```sh
npm run typecheck
npx @flow-engineer/flow check
npm test -- --synthetic         # scenarios in tests/scenarios, run in Flow's test cloud
```

## How it is put together

- `src/kite.ts`: Kite Connect client. `src/sessions.ts`: the daily login, kept in the agent's own records.
- `src/tools.ts`: the tools. `src/routes.ts`: the Redirect and Postback URLs. `src/alerts.ts`: WhatsApp pings for alerts.
- `agent/AGENTS.md`: the agent's prompt (what it may and may not do). `tests/`: tool behaviours and scenarios.

Things we learned on Flow's hosting, in case you deploy there:

- The agent's own `routes` are not exposed publicly, so Zerodha's two URLs are also mounted through the MCP
  server's `auth.routes` (`src/mcp.ts`).
- Hosting fills the provider keys (`OPENROUTER_API_KEY` and others) with values that win over `FLOW_KEY`, so the
  hosted agent uses `flowModel()` (`src/agent.ts`).

## Contributing

Issues and pull requests are welcome. Please keep it read-only-safe by default, and never include real account
data, keys or screenshots with real balances.

## License

[Apache-2.0](LICENSE).
