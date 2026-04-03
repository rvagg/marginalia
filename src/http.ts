import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { deliver } from './mcp.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

export interface WebState {
  clients: Set<WebSocket>
  lastDiff: string
  projectDir: string
  seq: number
}

async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath)
    const ext = filePath.substring(filePath.lastIndexOf('.'))
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

function handleHttpRequest(uiDir: string, state: WebState) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (url.pathname === '/') {
      return serveStatic(res, join(uiDir, 'index.html'))
    }

    const staticFile = url.pathname.replace(/^\//, '')
    if (/^[\w.-]+\.(css|js)$/.test(staticFile)) {
      return serveStatic(res, join(uiDir, staticFile))
    }

    if (url.pathname === '/api/diff') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ diff: state.lastDiff, projectDir: state.projectDir }))
      return
    }

    res.writeHead(404)
    res.end('not found')
  }
}

function handleWebSocketMessage(ws: WebSocket, state: WebState, mcp: McpServer, raw: Buffer) {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw.toString())
  } catch {
    return
  }

  switch (msg.type) {
    case 'comment': {
      const threadId = `t_${++state.seq}`
      const isFileLevel = Number(msg.line) === 0
      const meta: Record<string, string> = {
        type: isFileLevel ? 'file' : 'inline',
        file: String(msg.file),
        thread_id: threadId
      }
      if (!isFileLevel) {
        meta.line = String(msg.line)
        meta.side = String(msg.side)
      }
      deliver(mcp, String(msg.text), meta)
      ws.send(JSON.stringify({ ...msg, type: 'comment_ack', thread_id: threadId }))
      break
    }
    case 'thread_reply': {
      deliver(mcp, String(msg.text), { type: 'thread_reply', thread_id: String(msg.thread_id) })
      break
    }
    case 'general': {
      const threadId = `t_${++state.seq}`
      deliver(mcp, String(msg.text), { type: 'general', thread_id: threadId })
      ws.send(JSON.stringify({ ...msg, type: 'comment_ack', thread_id: threadId }))
      break
    }
    case 'permission_verdict': {
      void mcp.notification({
        method: 'notifications/claude/channel/permission' as any,
        params: {
          request_id: String(msg.request_id),
          behavior: String(msg.behavior)
        }
      })
      break
    }
  }
}

function handleWebSocketConnection(ws: WebSocket, state: WebState, mcp: McpServer) {
  state.clients.add(ws)
  ws.send(JSON.stringify({ type: 'init', diff: state.lastDiff, projectDir: state.projectDir }))
  ws.on('message', (raw: Buffer) => handleWebSocketMessage(ws, state, mcp, raw))
  ws.on('close', () => { state.clients.delete(ws) })
}

export function createHttpServer(uiDir: string, state: WebState, mcp: McpServer) {
  const httpServer = createServer(handleHttpRequest(uiDir, state))
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (ws: WebSocket) => handleWebSocketConnection(ws, state, mcp))
  return httpServer
}
