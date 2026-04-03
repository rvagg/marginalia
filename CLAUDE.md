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
  mcp.ts       MCP channel server, tools (reply, get_url), permission relay
  http.ts      HTTP static server, WebSocket message handling
  diff.ts      Git diff engine (temporary index, polling)
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

## Building

```bash
npm install
npm run build    # tsc -> dist/
```

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

- `MARGINALIA_PORT` - HTTP port (default: `3456`, use `0` for OS-assigned)
- `MARGINALIA_HOST` - Listen address (default: `127.0.0.1`, use `0.0.0.0` for remote access)

### Docker

The `~/bin/claude-docker/` setup supports marginalia:
- `run.sh` mounts `~/git/marginalia` read-only at `/marginalia`
- `docker-entrypoint.sh` copies to `/tmp/marginalia`, installs deps, writes MCP config
- `claude-wrapper.sh` adds `--dangerously-load-development-channels` when marginalia is present
- Set `MARGINALIA_PORT=3456` env var to map the port out of the container
- Container defaults `MARGINALIA_HOST=0.0.0.0` since port mapping requires it

### Permission auto-approve

To avoid approve/deny prompts for marginalia's own tools:

```json
{
  "permissions": {
    "allow": ["mcp__marginalia__reply", "mcp__marginalia__get_url"]
  }
}
```

Add to `.claude/settings.local.json` in the project you're reviewing.

## MCP tools

- **`reply`** - Reply to a comment thread. Params: `thread_id`, `text` (markdown), `ephemeral` (boolean). Ephemeral replies show as transient status, replaced by next non-ephemeral reply.
- **`get_url`** - Returns the server URL. Useful when using random port (`MARGINALIA_PORT=0`).

## Instructions to Claude

The MCP `instructions` field tells Claude to:
- Only use the `reply` tool when responding to `<channel source="marginalia">` messages
- If the user types in the terminal (no `<channel>` tag), respond in the terminal normally
- Do not duplicate responses across both surfaces
- Send an ephemeral reply before taking action on review comments
- Replies support markdown

## Development notes

- No build step for `ui/` files, they're served directly
- `npm run build` compiles `src/*.ts` to `dist/*.js`
- When developing marginalia itself, remove `--watch` from the MCP command to avoid crash loops on compile errors with a fixed port (another instance can steal the port during restart)
- Browser hard-refresh (Ctrl+Shift+R) needed after CSS changes since the server doesn't set cache headers
