# marginalia

[![NPM](https://nodei.co/npm/@rvagg/marginalia.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@rvagg/marginalia/)

Live code review UI for Claude Code. Browse git diffs in the browser, leave inline comments, and converse with your AI agent around the code itself.

## How it works

Marginalia is an MCP channel server that Claude Code spawns as a subprocess. It runs a local HTTP server with a diff review UI. You review code in the browser while Claude watches for your comments and responds in real-time. File changes from Claude update the diff view live.

```
Browser  <--WebSocket-->  MCP Channel Server  <--stdio-->  Claude Code
```

- Inline comments on diff lines flow to Claude as channel events
- Claude replies appear threaded under your comments
- File edits from Claude update the diff view automatically
- Permission prompts can be approved/denied from the browser

## Setup

Install globally:

```bash
npm install -g @rvagg/marginalia
```

Add to Claude Code:

```bash
claude mcp add -s user -t stdio marginalia -- marginalia
```

Or without a global install:

```bash
claude mcp add -s user -t stdio marginalia -- npx -y @rvagg/marginalia
```

Use `-e MARGINALIA_PORT=3456 -e MARGINALIA_HOST=0.0.0.0` before the server name to customise the port or listen address.

Start Claude Code with channels enabled:

```bash
claude --dangerously-load-development-channels server:marginalia
```

Open `http://localhost:3456` in your browser.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MARGINALIA_PORT` | `3456` | HTTP server port |
| `MARGINALIA_HOST` | `127.0.0.1` | Listen address (use `0.0.0.0` for remote access) |

## Multiple sessions

When running multiple Claude Code instances, each spawns its own marginalia server. If the default port is in use, marginalia automatically tries the next port (up to 10 attempts). Ask the agent "what's your marginalia URL?" and it will call `get_url` to tell you the actual port.

To assign fixed ports per session, set `MARGINALIA_PORT` in each instance's MCP config.

## Features

- GitHub-style diff rendering via diff2html with syntax highlighting
- Inline commenting on any diff line with threaded replies
- File-level comments anchored at the top of each file's diff
- General chat via the footer panel
- "Viewed" toggle to collapse reviewed files (auto-expands if the file changes)
- Copy file path button
- Ephemeral status messages ("Looking into this...") that get replaced by real replies
- Markdown rendering in comments and replies
- Permission relay for approving/denying tool use from the browser
- Live diff updates via 500ms polling

## License

Apache-2.0
