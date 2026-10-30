# Security

This agent can see a real brokerage account and, if you switch it on, place real orders. Treat it that way.

- **Never commit `.env`.** It holds your Kite API secret and your Flow keys. It is in `.gitignore`.
- **Keep order placing off** (`KITE_ORDERS_ENABLED=0`) until you have read the code and tested with a tiny quantity.
- **Lock the agent to your own number** with `KITE_ALLOWED_PHONE`, otherwise anyone who can message it can use the Zerodha tools once you are signed in.
- **Set `MCP_TOKEN`** (32+ characters) if you deploy the MCP endpoint publicly; every tool requires sign-in.
- If you pasted an API secret anywhere by mistake, regenerate it at https://developers.kite.trade/apps.

Found a vulnerability? Please open a private security advisory on this repository rather than a public issue.
