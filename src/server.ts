#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { WebSocket } from 'ws'
import { createMcpServer } from './mcp.js'
import { createHttpServer } from './http.js'
import { getCurrentDiff } from './diff.js'

const ROOT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'))

const PORT = parseInt(process.env.MARGINALIA_PORT ?? '3456', 10)
const HOST = process.env.MARGINALIA_HOST ?? '127.0.0.1'
const PROJECT_DIR = process.cwd()
const UI_DIR = join(ROOT_DIR, 'ui')

// Shared state

const state = {
  clients: new Set<WebSocket>(),
  lastDiff: '',
  projectDir: PROJECT_DIR,
  seq: 0
}

let serverUrl = ''

function broadcast(msg: Record<string, unknown>): void {
  const data = JSON.stringify(msg)
  for (const ws of state.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

// MCP channel server

const mcp = createMcpServer(broadcast, () => serverUrl, version)

// HTTP + WebSocket server

const httpServer = createHttpServer(UI_DIR, state, mcp)

// Diff polling

async function pollDiff(): Promise<void> {
  const diff = await getCurrentDiff(PROJECT_DIR)
  if (diff !== state.lastDiff) {
    state.lastDiff = diff
    broadcast({ type: 'diff', diff })
  }
}

// Start

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport())

  state.lastDiff = await getCurrentDiff(PROJECT_DIR)

  setInterval(pollDiff, 500)

  httpServer.listen(PORT, HOST, () => {
    const addr = httpServer.address()
    const boundPort = typeof addr === 'object' && addr ? addr.port : PORT
    const boundHost = typeof addr === 'object' && addr ? addr.address : HOST
    serverUrl = `http://${boundHost}:${boundPort}`
    process.stderr.write(`marginalia: ${serverUrl}\n`)
    process.stderr.write(`marginalia: watching ${PROJECT_DIR}\n`)
  })
}

main().catch((err) => {
  process.stderr.write(`marginalia: fatal: ${err}\n`)
  process.exit(1)
})
