# Marginalia agent guide

Marginalia is a local, session-scoped code review sidecar for coding agents. It serves the current Git diff in a browser, accepts inline and general comments, sends those comments to the connected agent client, and returns agent replies to browser threads.

## Runtime shape

```text
Browser <--WebSocket--> HTTP/MCP process <--stdio--> Agent client
```

- `src/server.ts` wires lifecycle, shared state, the HTTP server, diff polling, and MCP stdio transport.
- `src/mcp.ts` defines MCP tools, the pending-comments resource, subscriptions, Claude channel compatibility, and permission relay.
- `src/http.ts` serves `ui/`, exposes HTTP endpoints, and translates WebSocket review events.
- `src/comments.ts` owns the mailbox, safe channel serialization, draining, and thread acknowledgement.
- `src/diff.ts` builds a complete working-tree diff through a temporary Git index.
- `src/poller.ts` polls only while browser clients exist and prevents overlapping Git work.
- `ui/app.js` is the uncompiled browser application.
- `ui/style.css` owns Marginalia layout and component styles.
- `ui/diff2html-theme.css` contains all overrides of diff2html, including the necessary `!important` rules.

## Contracts that must remain true

### Comment delivery

Every browser comment enters `CommentMailbox` once. Live delivery then uses one signal:

- A subscribed MCP client receives `notifications/resources/updated` for `marginalia://comments/pending`.
- Without a subscription, Claude Code-compatible clients receive `notifications/claude/channel`.
- Clients without either mechanism call `poll_comments`.

Resource reads are non-destructive. `poll_comments` and `GET /api/pending-comments` drain the mailbox. A final `reply` acknowledges and removes that thread; an ephemeral reply leaves it pending.

Do not broadcast both live signals for one comment. Clients may support both and would receive duplicates.

### Review replies

When operating through Marginalia:

- Reply to `<channel source="marginalia" ...>` only through the `reply` MCP tool, using the matching `thread_id`.
- Send an ephemeral acknowledgement before investigating or editing.
- Replace it with a concise final reply describing the result.
- Do not duplicate Marginalia replies in the terminal.
- Terminal prompts without a Marginalia channel tag receive normal terminal responses.

### Diff safety

`getCurrentDiff()` stages tracked and untracked files into a per-call temporary index and diffs it against `HEAD`, or the empty tree in a repository without commits. The user's real index must never change. Keep each call isolated so concurrent or slow polls cannot contend.

### UI boundaries

The browser code is vanilla JavaScript and is served directly. UI changes do not require a TypeScript build, and static assets use `Cache-Control: no-cache`.

Keep normal UI rules in `ui/style.css`. Keep diff2html-specific overrides in `ui/diff2html-theme.css`; do not spread library-fighting selectors into the component stylesheet.

The light theme intentionally tracks GitHub's review palette and proportional UI typography to reduce visual friction. Code remains monospace.

### Lifecycle

The MCP process starts idle unless `MARGINALIA_AUTO_START=1`. The `start` tool accepts optional `dir`, `port`, and `host` values. Only pass values the user explicitly requests; environment variables and defaults handle the rest.

- `MARGINALIA_PORT`: preferred port, default `0` for an available port.
- `MARGINALIA_HOST`: listen address, default `127.0.0.1`.
- `MARGINALIA_AUTO_START`: set to `1` to start against the session working directory.

If binding to `0.0.0.0`, report a usable browser address such as `127.0.0.1:<port>` for local access. The process must exit when its parent closes stdin.

## MCP surface

The server exposes:

- `start`: start review for a directory.
- `stop`: stop HTTP and diff polling.
- `reply`: reply to a browser thread; `ephemeral: true` is transient.
- `get_url`: return the active browser URL.
- `show_context`: display a project-relative source range in the browser.
- `poll_comments`: drain queued comments for clients without live delivery.

Protocol changes must preserve standard MCP behavior first, with Claude-specific behavior kept as a compatibility adapter.

## Development

Requirements: Node.js 24 or newer. TypeScript uses strict ESM with `NodeNext` resolution.

```bash
npm install
npm run build
npm test
```

- Source and tests live together under `src/`; generated `dist/` output is gitignored.
- `npm test` builds, then runs all compiled `node:test` files.
- Add tests for observable protocol or mailbox behavior. Cover subscribed and unsubscribed delivery separately when changing comment flow.
- Verify UI changes in a browser against the live server. A passing TypeScript build does not verify rendering or interaction.
- Do not edit generated `dist/` files.
