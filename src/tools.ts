// The agent's tools, over one Zerodha account through Kite Connect (src/kite.ts). A tool is a task, not an
// endpoint. Placing orders is off until KITE_ORDERS_ENABLED=1, and capped by KITE_MAX_QUANTITY and
// KITE_MAX_ORDER_VALUE, so a first run can only read.

import { createHash } from "node:crypto";
import { tool, z, type ToolContext } from "@flow-engineer/flow";
import { kite, loginUrl } from "./kite.ts";
import { sessionFor, startLogin } from "./sessions.ts";

// One Kite call with the stored login (the number in KITE_ALLOWED_PHONE, when set, is the only one let in).
const api = async <T>(context: ToolContext, method: "GET" | "POST" | "PUT" | "DELETE", path: string, form?: Record<string, string | number>, json?: unknown) => kite<T>(await sessionFor(context), method, path, form, json);

interface Order {
  order_id: string;
  status: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  quantity: number;
  filled_quantity: number;
  average_price: number;
  price: number;
  order_type: string;
  product: string;
  tag?: string;
  order_timestamp: string;
  status_message?: string;
}

interface Gtt {
  id: number;
  status: string;
  expires_at: string;
  condition: { exchange: string; tradingsymbol: string; trigger_values: number[]; last_price: number };
  orders: Array<{ transaction_type: string; quantity: number; price: number; product: string }>;
}

const gttSummary = (t: Gtt) => ({
  trigger_id: t.id,
  status: t.status,
  symbol: `${t.condition.exchange}:${t.condition.tradingsymbol}`,
  trigger_price: t.condition.trigger_values[0],
  side: t.orders[0]?.transaction_type,
  quantity: t.orders[0]?.quantity,
  limit_price: t.orders[0]?.price,
  product: t.orders[0]?.product,
  expires_at: t.expires_at,
});

const summary = (o: Order) => ({
  order_id: o.order_id,
  status: o.status,
  symbol: `${o.exchange}:${o.tradingsymbol}`,
  side: o.transaction_type,
  quantity: o.quantity,
  filled: o.filled_quantity,
  average_price: o.average_price,
  price: o.price,
  order_type: o.order_type,
  product: o.product,
  placed_at: o.order_timestamp,
  note: o.status_message ?? undefined,
});

export const tools = [
  tool({
    name: "kite_login_link",
    title: "Zerodha login link",
    description: "The link to sign in to Zerodha. The token expires every morning, so send it when another tool says login is needed.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => ({ login_url: loginUrl(await startLogin(context)), note: "Sign in with your Zerodha password and 2FA. The link works once, for 15 minutes. The connection lasts until about 6 AM IST tomorrow." }),
  }),
  tool({
    name: "kite_funds",
    title: "Funds and margins",
    description: "Available cash and used margin for equity and commodity, in INR.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => {
      const margins = await api<Record<string, { enabled: boolean; net: number; available: { cash: number; live_balance: number }; utilised: { debits: number } }>>(context, "GET", "/user/margins");
      return Object.fromEntries(
        Object.entries(margins).map(([segment, m]) => [segment, { enabled: m.enabled, net: m.net, available_cash: m.available.cash, live_balance: m.available.live_balance, used: m.utilised.debits }]),
      );
    },
  }),
  tool({
    name: "kite_holdings",
    title: "Holdings",
    description: "Long-term equity holdings: quantity, average cost, last price and P&L per stock, in INR, with the total.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => {
      const holdings = await api<Array<{ tradingsymbol: string; exchange: string; quantity: number; t1_quantity: number; average_price: number; last_price: number; pnl: number; day_change_percentage: number }>>(context, "GET", "/portfolio/holdings");
      const rows = holdings.map((h) => ({ symbol: `${h.exchange}:${h.tradingsymbol}`, quantity: h.quantity + h.t1_quantity, average_price: h.average_price, last_price: h.last_price, pnl: h.pnl, day_change_percent: h.day_change_percentage }));
      return { holdings: rows, count: rows.length, total_pnl: rows.reduce((sum, r) => sum + r.pnl, 0), covers: "All holdings, none left out." };
    },
  }),
  tool({
    name: "kite_positions",
    title: "Positions",
    description: "Open positions for today (net) with quantity, average price, last price and P&L in INR, and the total day P&L.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => {
      const { net } = await api<{ net: Array<{ tradingsymbol: string; exchange: string; product: string; quantity: number; average_price: number; last_price: number; pnl: number }> }>(context, "GET", "/portfolio/positions");
      const rows = net.map((p) => ({ symbol: `${p.exchange}:${p.tradingsymbol}`, product: p.product, quantity: p.quantity, average_price: p.average_price, last_price: p.last_price, pnl: p.pnl }));
      return { positions: rows, count: rows.length, total_pnl: rows.reduce((sum, r) => sum + r.pnl, 0), covers: "All net positions today." };
    },
  }),
  tool({
    name: "kite_orders",
    title: "Today's orders",
    description: "Every order from today with its status (OPEN, COMPLETE, REJECTED, CANCELLED), or the history of one order when order_id is given.",
    input: z.object({ order_id: z.string().optional().describe("One order's id; leave out for all of today's orders") }),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async ({ order_id }, context) => {
      if (order_id) return { history: (await api<Order[]>(context, "GET", `/orders/${encodeURIComponent(order_id)}`)).map(summary) };
      const orders = (await api<Order[]>(context, "GET", "/orders")).map(summary);
      return { orders, count: orders.length, covers: "All of today's orders." };
    },
  }),
  tool({
    name: "kite_place_order",
    title: "Place an order",
    description: "Place one equity order after the person has confirmed the exact symbol, side, quantity, type and price. Returns the order id. Needs confirmed: true.",
    input: z.object({
      confirmed: z.literal(true).describe("True only after the person said yes to the exact order read back to them"),
      exchange: z.enum(["NSE", "BSE", "NFO", "BFO", "MCX"]),
      tradingsymbol: z.string().min(1).describe("Symbol as Kite names it, such as INFY or RELIANCE"),
      transaction_type: z.enum(["BUY", "SELL"]),
      quantity: z.number().int().min(1),
      order_type: z.enum(["MARKET", "LIMIT"]),
      product: z.enum(["CNC", "MIS", "NRML"]).describe("CNC delivery, MIS intraday, NRML futures and options carry-forward"),
      price: z.number().positive().optional().describe("Required for LIMIT, in INR"),
    }),
    status: { running: "Placing your order…", done: "Order placed" },
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    signIn: "required",
    run: async (order, context) => {
      const { idempotencyKey } = context;
      if (process.env.KITE_ORDERS_ENABLED !== "1") throw new Error("Order placing is switched off (KITE_ORDERS_ENABLED is not 1). Nothing was sent to Zerodha.");
      const maxQuantity = Number(process.env.KITE_MAX_QUANTITY ?? 10);
      const maxValue = Number(process.env.KITE_MAX_ORDER_VALUE ?? 10_000);
      if (order.quantity > maxQuantity) throw new Error(`Quantity ${order.quantity} is over the limit of ${maxQuantity}. Nothing was sent.`);
      if (order.order_type === "LIMIT") {
        if (!order.price) throw new Error("A LIMIT order needs a price.");
        if (order.price * order.quantity > maxValue) throw new Error(`Order value is over the limit of ₹${maxValue}. Nothing was sent.`);
      }
      // Kite's tag (20 characters at most) makes a repeated call find the order it already placed.
      const tag = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20);
      const existing = (await api<Order[]>(context, "GET", "/orders")).find((o) => o.tag === tag);
      if (existing) return { order_id: existing.order_id, duplicate: true };
      const placed = await api<{ order_id: string }>(context, "POST", "/orders/regular", {
        exchange: order.exchange,
        tradingsymbol: order.tradingsymbol,
        transaction_type: order.transaction_type,
        quantity: order.quantity,
        order_type: order.order_type,
        product: order.product,
        validity: "DAY",
        tag,
        ...(order.price ? { price: order.price } : {}),
      });
      return { order_id: placed.order_id, note: "Sent to the exchange. Use kite_orders for its status." };
    },
  }),
  tool({
    name: "kite_cancel_order",
    title: "Cancel an order",
    description: "Cancel an open order by its id after the person has confirmed.",
    input: z.object({ confirmed: z.literal(true).describe("True only after the person said yes"), order_id: z.string() }),
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    signIn: "required",
    run: async ({ order_id }, context) => {
      if (process.env.KITE_ORDERS_ENABLED !== "1") throw new Error("Order changes are switched off (KITE_ORDERS_ENABLED is not 1). Nothing was sent.");
      return api<{ order_id: string }>(context, "DELETE", `/orders/regular/${encodeURIComponent(order_id)}`);
    },
  }),
  tool({
    name: "kite_price_level",
    title: "Price level from a percentage",
    description: "The exact price that is a percentage below or above a price, rounded to the exchange tick of 0.05. Use it for every 'x% drop from here' or trigger calculation; never work the arithmetic out yourself.",
    input: z.object({
      price: z.number().positive().describe("The starting price in INR"),
      percent: z.number().positive().max(100),
      direction: z.enum(["down", "up"]),
    }),
    signIn: "none",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async ({ price, percent, direction }) => {
      const exact = price * (1 + (direction === "down" ? -percent : percent) / 100);
      return { level: Number((Math.round(exact / 0.05) * 0.05).toFixed(2)), exact: Number(exact.toFixed(4)), note: "Rounded to the nearest ₹0.05." };
    },
  }),
  tool({
    name: "kite_order_cost",
    title: "What an order would cost",
    description: "For an order the person is only thinking about: the margin it needs and the full charges (brokerage, STT, exchange, SEBI, stamp duty, GST) in INR. Places nothing.",
    input: z.object({
      exchange: z.enum(["NSE", "BSE", "NFO", "BFO", "MCX"]),
      tradingsymbol: z.string().min(1),
      transaction_type: z.enum(["BUY", "SELL"]),
      quantity: z.number().int().min(1),
      product: z.enum(["CNC", "MIS", "NRML"]),
      order_type: z.enum(["MARKET", "LIMIT"]),
      price: z.number().positive().describe("The expected price per share in INR (the limit price, or the last price for a market order)"),
    }),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (o, context) => {
      const base = { exchange: o.exchange, tradingsymbol: o.tradingsymbol, transaction_type: o.transaction_type, variety: "regular", product: o.product, order_type: o.order_type, quantity: o.quantity };
      type Charges = { transaction_tax: number; transaction_tax_type: string; exchange_turnover_charge: number; sebi_turnover_charge: number; brokerage: number; stamp_duty: number; gst: { total: number }; total: number };
      const [margin, charges] = await Promise.all([
        api<Array<{ total: number }>>(context, "POST", "/margins/orders", undefined, [{ ...base, price: o.order_type === "LIMIT" ? o.price : 0, trigger_price: 0 }]),
        api<Array<{ charges: Charges }>>(context, "POST", "/charges/orders", undefined, [{ ...base, order_id: "estimate", average_price: o.price }]),
      ]);
      const c = charges[0].charges;
      const round = (n: number) => Number(n.toFixed(2));
      return {
        margin_required: round(margin[0].total),
        order_value: round(o.price * o.quantity),
        charges: { brokerage: round(c.brokerage), [c.transaction_tax_type]: round(c.transaction_tax), exchange: round(c.exchange_turnover_charge), sebi: round(c.sebi_turnover_charge), stamp_duty: round(c.stamp_duty), gst: round(c.gst.total), total: round(c.total) },
        note: "An estimate. Nothing was placed.",
      };
    },
  }),
  tool({
    name: "kite_alert_create",
    title: "Price alert",
    description: "A price alert on Zerodha: when the last traded price reaches the level, Kite notifies the person in the Kite app and this chat sends them a WhatsApp message within a couple of minutes (while they are signed in that day). It places no order.",
    input: z.object({
      exchange: z.enum(["NSE", "BSE", "NFO", "BFO", "MCX", "INDICES"]),
      tradingsymbol: z.string().min(1),
      operator: z.enum(["<=", ">="]).describe("<= alerts when the price falls to the level, >= when it rises to it"),
      price: z.number().positive().describe("The level in INR"),
    }),
    signIn: "required",
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    run: async (a, context) => {
      const created = await api<{ uuid: string; name: string; status: string }>(context, "POST", "/alerts", {
        name: `${a.tradingsymbol} ${a.operator} ${a.price}`,
        type: "simple",
        lhs_exchange: a.exchange,
        lhs_tradingsymbol: a.tradingsymbol,
        lhs_attribute: "LastTradedPrice",
        operator: a.operator,
        rhs_type: "constant",
        rhs_constant: a.price,
      });
      // The watcher (src/alerts.ts) messages WhatsApp when its trigger count passes this.
      await context.records.put("kite_alert_seen", created.uuid, { count: 0 });
      return { alert_id: created.uuid, name: created.name, status: created.status, note: "You will get a WhatsApp message here when it fires (checked every couple of minutes while you are signed in), and Kite notifies you in the app too. No order is placed." };
    },
  }),
  tool({
    name: "kite_alerts_list",
    title: "Price alerts",
    description: "The person's price alerts on Zerodha: id, what it watches, the level and whether it is enabled.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => {
      const alerts = await api<Array<{ uuid: string; name: string; status: string; lhs_exchange: string; lhs_tradingsymbol: string; operator: string; rhs_constant: number; alert_count: number }>>(context, "GET", "/alerts");
      const rows = alerts.map((a) => ({ alert_id: a.uuid, symbol: `${a.lhs_exchange}:${a.lhs_tradingsymbol}`, condition: `${a.operator} ${a.rhs_constant}`, status: a.status, times_triggered: a.alert_count }));
      return { alerts: rows, count: rows.length, covers: "All alerts.", whatsapp: "Every enabled alert here is also messaged to this WhatsApp chat automatically when it fires, within a couple of minutes while the person is signed in. Say so; do not say it only reaches the Kite app, and do not offer a scheduled check." };
    },
  }),
  tool({
    name: "kite_alert_delete",
    title: "Delete a price alert",
    description: "Delete one price alert by its id after the person has confirmed.",
    input: z.object({ confirmed: z.literal(true).describe("True only after the person said yes"), alert_id: z.string() }),
    signIn: "required",
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    run: async ({ alert_id }, context) => {
      await api<null>(context, "DELETE", `/alerts?uuid=${encodeURIComponent(alert_id)}`);
      return { deleted: alert_id };
    },
  }),
  tool({
    name: "kite_gtt_list",
    title: "GTT orders",
    description: "The person's GTT orders (good-till-triggered: they wait on Zerodha's servers for a price, then place an order): id, status, symbol, trigger, side, quantity and limit price.",
    input: z.object({}),
    signIn: "required",
    hints: { readOnly: true, idempotent: true, openWorld: false },
    run: async (_input, context) => {
      const rows = (await api<Gtt[]>(context, "GET", "/gtt/triggers")).map(gttSummary);
      return { gtts: rows, count: rows.length, covers: "All GTTs." };
    },
  }),
  tool({
    name: "kite_gtt_create",
    title: "Set a GTT order",
    description:
      "A GTT: Zerodha watches the price and, when it reaches trigger_price, places a LIMIT order at limit_price. It stays active up to about a year. Needs confirmed: true after the person has confirmed the exact symbol, side, quantity, trigger and limit price. last_price is the current price (from kite_holdings).",
    input: z.object({
      confirmed: z.literal(true).describe("True only after the person said yes to the exact GTT read back to them"),
      exchange: z.enum(["NSE", "BSE"]),
      tradingsymbol: z.string().min(1),
      transaction_type: z.enum(["BUY", "SELL"]),
      quantity: z.number().int().min(1),
      trigger_price: z.number().positive().describe("When the price reaches this, the order is placed"),
      limit_price: z.number().positive().describe("The limit price of the order it places; for a sell, a little under the trigger so it fills"),
      last_price: z.number().positive().describe("The current price, from kite_holdings"),
      product: z.enum(["CNC", "NRML"]).default("CNC"),
    }),
    status: { running: "Setting your GTT…", done: "GTT set" },
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    signIn: "required",
    run: async (g, context) => {
      if (process.env.KITE_ORDERS_ENABLED !== "1") throw new Error("Order placing is switched off (KITE_ORDERS_ENABLED is not 1). Nothing was sent to Zerodha.");
      const maxQuantity = Number(process.env.KITE_MAX_QUANTITY ?? 10);
      const maxValue = Number(process.env.KITE_MAX_ORDER_VALUE ?? 10_000);
      if (g.quantity > maxQuantity) throw new Error(`Quantity ${g.quantity} is over the limit of ${maxQuantity}. Nothing was sent.`);
      if (g.limit_price * g.quantity > maxValue) throw new Error(`Order value is over the limit of ₹${maxValue}. Nothing was sent.`);
      // A repeated call finds the GTT it already made instead of making a second one.
      const same = (await api<Gtt[]>(context, "GET", "/gtt/triggers")).find(
        (t) => t.status === "active" && t.condition.tradingsymbol === g.tradingsymbol && t.condition.trigger_values[0] === g.trigger_price && t.orders[0]?.quantity === g.quantity && t.orders[0]?.transaction_type === g.transaction_type,
      );
      if (same) return { trigger_id: same.id, duplicate: true };
      const made = await api<{ trigger_id: number }>(context, "POST", "/gtt/triggers", {
        type: "single",
        condition: JSON.stringify({ exchange: g.exchange, tradingsymbol: g.tradingsymbol, trigger_values: [g.trigger_price], last_price: g.last_price }),
        orders: JSON.stringify([{ exchange: g.exchange, tradingsymbol: g.tradingsymbol, transaction_type: g.transaction_type, quantity: g.quantity, order_type: "LIMIT", product: g.product, price: g.limit_price }]),
      });
      return { trigger_id: made.trigger_id, note: "Zerodha now watches the price. When it reaches the trigger it places the order; the update comes here if the Postback URL is set." };
    },
  }),
  tool({
    name: "kite_gtt_delete",
    title: "Delete a GTT",
    description: "Delete one GTT by its id after the person has confirmed.",
    input: z.object({ confirmed: z.literal(true).describe("True only after the person said yes"), trigger_id: z.number().int() }),
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    signIn: "required",
    run: async ({ trigger_id }, context) => {
      if (process.env.KITE_ORDERS_ENABLED !== "1") throw new Error("Order changes are switched off (KITE_ORDERS_ENABLED is not 1). Nothing was sent.");
      return api<{ trigger_id: number }>(context, "DELETE", `/gtt/triggers/${trigger_id}`);
    },
  }),
];
