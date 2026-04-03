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

## Usage

By default, marginalia starts idle. Ask the agent to start it:

> "start marginalia on src/myproject/"

> "start marginalia on 0.0.0.0"

> "start marginalia"

The agent calls the `start` tool, picks a port, and gives you the URL. Only parameters you mention are set; everything else uses defaults.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MARGINALIA_PORT` | `0` (random) | Default HTTP server port |
| `MARGINALIA_HOST` | `127.0.0.1` | Default listen address (use `0.0.0.0` for remote access) |
| `MARGINALIA_AUTO_START` | off | Set to `1` to start the server automatically on the session's working directory |

## Multiple sessions

Each Claude Code instance has its own marginalia server. With the default random port, there are no collisions. Ask "what's your marginalia URL?" and the agent will tell you.

To assign fixed ports, set `MARGINALIA_PORT`. If the port is in use, marginalia tries the next port (up to 10 attempts).

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
