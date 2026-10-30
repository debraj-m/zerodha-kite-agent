// The two URLs Zerodha calls, served beside the agent (createAgent `routes`):
//   /zerodha/callback   the app's Redirect URL: Zerodha sends the person here after login with ?request_token=
//   /zerodha/postback   the app's Postback URL: Zerodha POSTs each order update here, signed with a checksum

import { postbackValid } from "./kite.ts";
import { completeLogin } from "./sessions.ts";

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Called with each verified order update, such as to message the owner. */
export type OnOrderUpdate = (update: { order_id: string; status: string; tradingsymbol: string; transaction_type: string; quantity: number; filled_quantity: number; average_price: number; user_id: string }) => void | Promise<void>;

export function kiteRoutes(onOrderUpdate?: OnOrderUpdate) {
  return {
    "/zerodha/callback": async (request: Request) => {
      const query = new URL(request.url).searchParams;
      const token = query.get("request_token");
      const state = query.get("state");
      if (query.get("status") !== "success" || !token || !state) return page("Login not finished", "Zerodha did not return a login. Start again from the login link.", 400);
      try {
        const user_id = await completeLogin(state, token);
        return page("Zerodha connected", `Signed in as ${user_id}. Go back to the chat; the connection lasts until about 6 AM IST tomorrow.`);
      } catch (error) {
        return page("Login failed", (error as Error).message.replace(/[<>&]/g, ""), 502);
      }
    },
    "/zerodha/postback": async (request: Request) => {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      const update = (await request.json().catch(() => null)) as (Parameters<NonNullable<OnOrderUpdate>>[0] & { order_timestamp: string; checksum: string }) | null;
      if (!update?.order_id || !update.order_timestamp) return new Response("bad checksum", { status: 401 });
      let valid: boolean;
      try {
        valid = postbackValid(update.order_id, update.order_timestamp, update.checksum);
      } catch {
        return new Response("not configured", { status: 503 });
      }
      if (!valid) return new Response("bad checksum", { status: 401 });
      await onOrderUpdate?.(update);
      return new Response("ok");
    },
  };
}

// Flow's hosting serves the MCP server's paths publicly but not the agent's `routes`, so the same two URLs
// are also offered as the MCP server's own routes (src/mcp.ts, `auth.routes`). That copy has no agent in
// reach, so agent.ts hands it the order-update notifier once the agent is built.
let notifier: OnOrderUpdate | undefined;
export const setOrderNotifier = (notify: OnOrderUpdate) => {
  notifier = notify;
};
const hosted = kiteRoutes((update) => notifier?.(update));
export const kiteHostedRoutes = {
  paths: ["/zerodha"],
  fetch: async (request: Request): Promise<Response> => (hosted[new URL(request.url).pathname as keyof typeof hosted]?.(request) ?? new Response("not found", { status: 404 })),
};
