#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer, type Server as HttpServer } from 'node:http'
import type { WebSocket } from 'ws'
import { createMcpServer } from './mcp.js'
import { createHttpServer } from './http.js'
import { getCurrentDiff } from './diff.js'
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
  seq: 0
}

let serverUrl = ''
let httpServer: HttpServer | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null

function broadcast(msg: Record<string, unknown>): void {
  const data = JSON.stringify(msg)
  for (const ws of state.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

// Lifecycle

const MAX_PORT_ATTEMPTS = 10

function tryListen(server: HttpServer, port: number, host: string, attempt: number): Promise<string> {
  return new Promise((resolve, reject) => {
    function onError(err: NodeJS.ErrnoException) {
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
        process.stderr.write(`marginalia: port ${port} in use, trying ${port + 1}\n`)
        tryListen(server, port + 1, host, attempt + 1).then(resolve, reject)
      } else {
        reject(err)
      }
    }

    server.once('error', onError)

    server.listen(port, host, () => {
      server.removeListener('error', onError)
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr ? addr.port : port
      const boundHost = typeof addr === 'object' && addr ? addr.address : host
      resolve(`http://${boundHost}:${boundPort}`)
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

  httpServer = createHttpServer(UI_DIR, state, mcp)
  serverUrl = await tryListen(httpServer, port, host, 1)

  pollInterval = setInterval(async () => {
    const diff = await getCurrentDiff(state.projectDir)
    if (diff !== state.lastDiff) {
      state.lastDiff = diff
      broadcast({ type: 'diff', diff })
    }
  }, 500)

  process.stderr.write(`marginalia: ${serverUrl}\n`)
  process.stderr.write(`marginalia: watching ${dir}\n`)

  return serverUrl
}

export async function stopServer(): Promise<void> {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
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

const mcp = createMcpServer({
  broadcast,
  getUrl: () => serverUrl,
  version,
  startServer,
  stopServer,
  isRunning: () => httpServer !== null
})

// Start

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport())

  if (AUTO_START) {
    await startServer()
  }
}

main().catch((err) => {
  process.stderr.write(`marginalia: fatal: ${err}\n`)
  process.exit(1)
})
