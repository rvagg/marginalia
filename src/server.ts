#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Server as HttpServer } from 'node:http'
import type { WebSocket } from 'ws'
import { createMcpServer } from './mcp.js'
import { createHttpServer } from './http.js'
import { getCurrentDiff } from './diff.js'
import { createDiffPoller, type DiffPoller } from './poller.js'
import type { WebState } from './http.js'

const ROOT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'))
const UI_DIR = join(ROOT_DIR, 'ui')

const DEFAULT_PORT = parseInt(process.env.MARGINALIA_PORT ?? '0', 10)
const DEFAULT_HOST = process.env.MARGINALIA_HOST ?? '127.0.0.1'
const AUTO_START = process.env.MARGINALIA_AUTO_START === '1'

// Shared state

const state: WebState = {
  clients: new Set<WebSocket>(),
  lastDiff: '',
  projectDir: process.cwd(),
  seq: 0,
  pendingComments: []
}

let serverUrl = ''
let httpServer: HttpServer | null = null
let poller: DiffPoller | null = null

function broadcast(msg: Record<string, unknown>): void {
  const data = JSON.stringify(msg)
  for (const ws of state.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

// Lifecycle

const MAX_PORT_ATTEMPTS = 10

function tryListen(port: number, host: string, attempt: number): Promise<{ server: HttpServer; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer(UI_DIR, state, mcp)

    function onError(err: NodeJS.ErrnoException) {
      server.close()
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
        process.stderr.write(`marginalia: port ${port} in use, trying ${port + 1}\n`)
        tryListen(port + 1, host, attempt + 1).then(resolve, reject)
      } else {
        reject(new Error(`could not bind to port ${port}: ${err.message}`))
      }
    }

    server.once('error', onError)

    server.listen(port, host, () => {
      server.removeListener('error', onError)
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr ? addr.port : port
      const boundHost = typeof addr === 'object' && addr ? addr.address : host
      resolve({ server, url: `http://${boundHost}:${boundPort}` })
    })
  })
}

export async function startServer(opts: { dir?: string; port?: number; host?: string } = {}): Promise<string> {
  if (httpServer) {
    await stopServer()
  }

  const dir = opts.dir ?? process.cwd()
  const port = opts.port ?? DEFAULT_PORT
  const host = opts.host ?? DEFAULT_HOST

  state.projectDir = dir
  state.lastDiff = await getCurrentDiff(dir)

  const result = await tryListen(port, host, 1)
  httpServer = result.server
  serverUrl = result.url

  poller = createDiffPoller({
    intervalMs: 500,
    getProjectDir: () => state.projectDir,
    getCurrentDiff,
    getLastDiff: () => state.lastDiff,
    setLastDiff: (diff) => { state.lastDiff = diff },
    hasClients: () => state.clients.size > 0,
    broadcast,
    log: (msg) => { process.stderr.write(msg) }
  })
  poller.start()

  process.stderr.write(`marginalia: ${serverUrl}\n`)
  process.stderr.write(`marginalia: watching ${dir}\n`)

  return serverUrl
}

export async function stopServer(): Promise<void> {
  if (poller) {
    poller.stop()
    poller = null
  }
  if (httpServer) {
    for (const ws of state.clients) ws.close()
    state.clients.clear()
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    httpServer = null
  }
  serverUrl = ''
  state.lastDiff = ''
}

// MCP channel server

function drainPendingComments(): string {
  const comments = state.pendingComments.splice(0)
  if (comments.length === 0) return ''
  return comments.map(c => {
    const attrs = Object.entries(c.meta).map(([k, v]) => `${k}="${v}"`).join(' ')
    return `<channel source="marginalia" ${attrs}>\n${c.content}\n</channel>`
  }).join('\n\n')
}

const mcp = createMcpServer({
  broadcast,
  getUrl: () => serverUrl,
  getProjectDir: () => state.projectDir,
  drainPendingComments,
  version,
  startServer,
  stopServer,
  isRunning: () => httpServer !== null
})

// Start

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport())

  if (AUTO_START) {
    try {
      await startServer()
    } catch (err) {
      process.stderr.write(`marginalia: auto-start failed: ${err instanceof Error ? err.message : err}\n`)
      // Don't exit — keep MCP server alive so the user can retry with start tool
    }
  }
}

process.on('unhandledRejection', (err) => {
  process.stderr.write(`marginalia: unhandled rejection: ${err instanceof Error ? err.stack : err}\n`)
})

process.on('uncaughtException', (err) => {
  process.stderr.write(`marginalia: uncaught exception: ${err.stack}\n`)
})

main().catch((err) => {
  process.stderr.write(`marginalia: fatal: ${err}\n`)
  process.exit(1)
})
