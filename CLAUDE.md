# Marginalia

Live code review UI for Claude Code. A local web UI that shows git diffs with inline commenting, threaded conversation, and bidirectional communication with a Claude Code session via the MCP channels protocol.

## What this is

An MCP channel server that Claude Code spawns as a subprocess. It runs a local HTTP + WebSocket server serving a diff review UI. The user reviews code in the browser, leaves inline and file-level comments that arrive in the Claude Code session as `<channel>` events. Claude replies via the `reply` tool and those responses appear threaded in the browser UI. File changes from Claude are picked up by the diff polling engine and the UI updates live.

## Architecture

```
Browser  <--WebSocket-->  MCP Channel Server  <--stdio-->  Claude Code
  |                            |
  |  diff2html + marked.js     |  node:http + ws
  |  vanilla JS (ui/app.js)    |
  |                            |  Polls git diff every 500ms
  |  Inline comments --------> |  -> notifications/claude/channel
  |  <-- reply tool ---------- |  <- Claude calls reply tool
  |  <-- diff updates -------- |  <- File changes detected
  |  Permission relay <------> |  <- claude/channel/permission
```

## Project structure

```
src/
  server.ts    Entry point, wiring, startup
  mcp.ts       MCP channel server, tools (start/stop/reply/get_url/show_context/poll_comments), permission relay
  http.ts      HTTP static server, WebSocket message handling
  diff.ts      Git diff engine (temporary index, polling)
  poller.ts    Diff polling loop with idle/overlap protection
dist/          Compiled JS output (gitignored)
ui/
  index.html   Page shell, CDN script tags
  app.js       All client-side logic (vanilla JS, not compiled)
  style.css    Our styles (variables, layout, components)
  diff2html-theme.css  diff2html !important overrides (separate to contain the mess)
```

## Key design decisions

**CSS split**: `style.css` has our own clean styles. `diff2html-theme.css` has all the `!important` overrides fighting diff2html's defaults. Keeps library-fighting CSS isolated.

**diff2html layout fix**: diff2html uses `position: absolute` on line numbers with padding on code lines to compensate. We override line numbers to `position: static; display: table-cell` so they scroll with content. The code line gets `padding: 0; width: 100%`.

**Diff engine**: Uses a temporary git index (`GIT_INDEX_FILE` env var) to `git add --all` without touching the real staging area. PID-scoped temp file in `os.tmpdir()` to avoid contention between instances. Handles repos with no commits by diffing against the empty tree hash (computed dynamically via `git hash-object`).

**Channel protocol**: Uses Claude Code's `claude/channel` experimental MCP capability. This is Claude Code-specific, not part of the core MCP spec. The `claude/` prefix is a vendor namespace. Other MCP clients would ignore it.

**Ephemeral replies**: The `reply` tool accepts `ephemeral: true` for transient status messages ("Looking into this...") that get replaced when a real reply arrives.

**Markdown rendering**: Claude's replies render as markdown via marked.js. User messages in threads also render markdown. Chat footer uses `parseInline` to avoid `<p>` tag line breaks.

**Thread replies**: Inline comment threads have a persistent reply input. Thread replies send `type: 'thread_reply'` with the existing `thread_id` (not creating new threads). In-progress reply text is preserved when the thread re-renders from incoming messages.

**File-level comments**: Use `line: 0` to distinguish from line comments. Since there's no diff row to anchor to, file-level thread replies fall back to the chat footer.

**Context snippets**: The `show_context` tool reads a project-relative file range and broadcasts a transient snippet above the diff. It is UI context only; it does not create a review thread.

**Comment queue**: Browser comments are always queued in `pendingComments` as well as delivered over `claude/channel`. `poll_comments` and `GET /api/pending-comments` drain the same queue, so draining is destructive.

## Building

```bash
npm install
npm run build    # tsc -> dist/
npm test         # build + node:test over compiled *.test.js
```

Tests live beside source as `src/*.test.ts` and compile to gitignored `dist/*.test.js`.

## Running in Claude Code

### Local setup

```bash
# Add MCP server (flags before name, -e is greedy so put it after the name)
claude mcp add -s user -t stdio marginalia node /path/to/marginalia/dist/server.js -e MARGINALIA_HOST=0.0.0.0 -e MARGINALIA_PORT=3456

# Start with channels
claude --dangerously-load-development-channels server:marginalia
```

**CLI flag ordering for `claude mcp add`**: The `-e` flag uses `<env...>` (variadic) and will greedily consume subsequent arguments. Put it after the server name to avoid it eating the name as an env var value.

### Environment variables

- `MARGINALIA_PORT` - Default port (default: `0` = random, set a number for fixed port)
- `MARGINALIA_HOST` - Default listen address (default: `127.0.0.1`, use `0.0.0.0` for remote access)
- `MARGINALIA_AUTO_START` - Set to `1` to start the server automatically on the session's working directory. Off by default.

### Startup modes

**On-demand (default):** The MCP server connects but stays idle. The user asks the agent to start, e.g. "start marginalia on src/myproject/". The agent calls the `start` tool, gets a URL, and reports it. All `start` parameters are optional; the agent should only set what the user explicitly provides.

**Auto-start:** Set `MARGINALIA_AUTO_START=1` to start immediately on the session's cwd. Useful for single-repo sessions and Docker containers.

### Docker

The `~/bin/claude-docker/` setup supports marginalia:
- `run.sh` mounts `~/git/marginalia` read-only at `/marginalia`
- `docker-entrypoint.sh` copies to `/tmp/marginalia`, installs deps, writes MCP config
- `claude-wrapper.sh` adds `--dangerously-load-development-channels` when marginalia is present
- Container sets `MARGINALIA_AUTO_START=1`, `MARGINALIA_HOST=0.0.0.0` by default
- Set `MARGINALIA_PORT=3456` env var to map the port out of the container

### Permission auto-approve

To avoid approve/deny prompts for marginalia's own tools:

```json
{
  "permissions": {
    "allow": ["mcp__marginalia__start", "mcp__marginalia__stop", "mcp__marginalia__reply", "mcp__marginalia__get_url"]
  }
}
```

Add to `.claude/settings.local.json` in the project you're reviewing.

## MCP tools

- **`start`** - Start the review server. Optional params: `dir` (directory to watch), `port`, `host`. All default from env vars or sensible defaults. The agent should only set params the user explicitly asks for.
- **`stop`** - Stop the review server.
- **`reply`** - Reply to a comment thread. Params: `thread_id`, `text` (markdown), `ephemeral` (boolean). Also accepts legacy `body`. Ephemeral replies show as transient status, replaced by next non-ephemeral reply.
- **`get_url`** - Returns the server URL if running.
- **`show_context`** - Broadcasts a file snippet to the UI. Params: `file`, `startLine`, `endLine`, optional `label`.
- **`poll_comments`** - Drains queued browser comments for clients without channel notifications.

## Instructions to Claude

The MCP `instructions` field tells Claude to:
- Only use the `reply` tool when responding to `<channel source="marginalia">` messages
- If the user types in the terminal (no `<channel>` tag), respond in the terminal normally
- Do not duplicate responses across both surfaces
- Send an ephemeral reply before taking action on review comments
- Replies support markdown

## Polling fallback (when channels are unavailable)

The MCP channels feature (`claude/channel`) is gated by a server-side feature flag and may not be available. When channels are disabled, comments from the web UI queue up and can be retrieved via polling.

**poll_comments tool**: The agent calls `poll_comments` to drain pending comments. Returns formatted `<channel>` tags or empty if none.

**HTTP endpoint**: `GET /api/pending-comments` returns and drains the queue as formatted text. Used by hooks.

**Hook setup** (recommended): Add to `.claude/settings.local.json` in your project:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "curl -sf http://localhost:${MARGINALIA_PORT:-3456}/api/pending-comments 2>/dev/null || true"
      }]
    }]
  }
}
```

This drains pending comments on every user message, so review comments arrive automatically.

**Loop fallback**: If hooks aren't set up, use `/loop 10s poll_comments` to poll periodically.

## Development notes

- No build step for `ui/` files, they're served directly
- `npm run build` compiles `src/*.ts` to `dist/*.js`
- `npm test` is the baseline quality check before handing off code changes
- Static UI assets are served with `Cache-Control: no-cache`; a normal reload should pick up CSS/JS changes
- When developing marginalia itself, remove `--watch` from the MCP command to avoid crash loops on compile errors with a fixed port (another instance can steal the port during restart)
- Binding to `0.0.0.0` returns a listen URL with that host; tell local users to open `127.0.0.1:<port>` or the machine LAN IP instead
