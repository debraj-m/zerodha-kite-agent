# zerodha-kite-agent

An agent on Flow Framework (https://github.com/flow-engineer/flow): a chat agent, and the same tools as an
MCP server and a CLI. It starts as the café example; replace the café with the owner's product.

- The skills are plain Markdown files, `.claude/skills/<skill>/SKILL.md`. A coding agent that does not
  load them by name (or started before this folder existed) reads them as files.
- Start with `flow-framework` in `.claude/skills/` for setup, names and layout. Then load only the
  relevant guides: `flow-framework-build-agent` for the messaging runtime, playground and deployment;
  `flow-framework-mcp` for MCP servers, CLIs and plugins; `flow-framework-tools` for tools and their
  test files; `flow-framework-tests` for scenarios; `flow-framework-context` to gather the context
  pack from an existing codebase; and `flow-framework-auth` for sign-in.
- `agent/AGENTS.md` is the agent's own prompt, not instructions for coding agents.
- The agent's names live in package.json, and the code reads them from there (src/name.ts):
  `name` is the package, the CLI command (keep the `bin` key the same), its `<NAME>_SERVER` and
  `<NAME>_TOKEN` variables and the MCP server's name; `displayName` is what people call the agent,
  also written in its prompt. To rename it, change `name` and the `bin` key; for the display name
  run `npx @flow-engineer/flow link --display-name <name>` (package.json and the prompt). Where
  people see each name: the flow-framework skill, "Names".
- The model key goes in `.env` (never read or print it): `npx @flow-engineer/flow link` (or `setup`)
  writes `FLOW_KEY`, the agent's one Flow key, which calls models on Flow's free trial credit, so no provider key is needed; a key the owner types
  (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) wins over it. `npm start` runs it in the playground,
  and `npx @flow-engineer/flow link` signs in, puts its other keys in `.env` and prints the link that
  reaches it from a phone while `npm start` runs.
- When the owner asks how to test it, recommend first the playground (`npm start`, then open the link
  it prints: the test people and the channels side by side), then their phone (the `link`).
- Your own checks, not the owner's way to test: `npx @flow-engineer/flow chat` talks to it in the
  terminal, `npm run typecheck` checks the types, `npm test -- --synthetic` runs the tests in the
  test cloud at https://flow.engineer/observe with the owner's `FLOW_FRAMEWORK_CLOUD_KEY`
  (`npx @flow-engineer/flow --help`).
- The guide for coding agents, with exit codes and next steps: https://github.com/flow-engineer/flow/blob/main/docs/agents.md
- `npm run mcp` serves the same tools as an MCP server (src/mcp.ts) and `npm run cli -- --help` is
  its command line (src/cli.ts). `npx flow check` checks the tools and the CLI file for both.
