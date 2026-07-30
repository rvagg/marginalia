import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CommentMailbox, COMMENTS_RESOURCE_URI } from './comments.js'

export type BroadcastFn = (msg: Record<string, unknown>) => void

interface McpOptions {
  broadcast: BroadcastFn
  getUrl: () => string
  getProjectDir: () => string
  mailbox: CommentMailbox
  version: string
  startServer: (opts?: { dir?: string; port?: number; host?: string }) => Promise<string>
  stopServer: () => Promise<void>
  isRunning: () => boolean
}

// Tool argument schemas

const StartArgs = z.object({
  dir: z.string().optional(),
  port: z.number().optional(),
  host: z.string().optional()
}).strict()

const ReplyArgs = z.object({
  thread_id: z.string(),
  text: z.string().optional(),
  body: z.string().optional(),
  ephemeral: z.boolean().optional()
}).strict().refine(
  d => d.text || d.body,
  { message: 'reply requires "text" (or "body") parameter' }
).transform(d => ({
  thread_id: d.thread_id,
  text: (d.text ?? d.body)!,
  ephemeral: d.ephemeral ?? false
}))

const ShowContextArgs = z.object({
  file: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  label: z.string().optional()
}).strict()

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(args)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
  return { ok: false, error: issues }
}

export function createMcpServer(opts: McpOptions) {
  const { broadcast, getUrl, getProjectDir, mailbox, version, startServer, stopServer, isRunning } = opts

  const mcp = new Server(
    { name: 'marginalia', version },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {}
        }
      },
      instructions: [
        'Marginalia is a live code review UI.',
        'Use the start tool to launch the review server. All parameters are optional.',
        'Do NOT guess or fill in parameters the user did not specify. Use defaults unless the user explicitly provides a directory, port, or host.',
        'After starting, tell the user the URL so they can open it in their browser.',
        'If the user says "start marginalia on foo/" that means dir=foo/. If they say "on 0.0.0.0" that means host=0.0.0.0. Only set what they mention.',
        `Code review comments arrive as <channel source="marginalia" ...> through channel notifications, the ${COMMENTS_RESOURCE_URI} resource, or poll_comments.`,
        `When notified that ${COMMENTS_RESOURCE_URI} changed, read mcp://${COMMENTS_RESOURCE_URI} to receive the pending comments.`,
        'IMPORTANT: Only use the reply tool when responding to <channel source="marginalia"> messages.',
        'If a message does NOT come from a <channel> tag, respond normally in the terminal.',
        'When you get a marginalia channel message, respond ONLY via the reply tool with the matching thread_id. Do not duplicate your response in the terminal.',
        'Replies support markdown.',
        'Before taking action on a review comment, send an ephemeral reply (ephemeral:true) so the user sees you are working on it. Then send the real reply when done.',
        'When you edit files in response to review feedback, the reviewer sees changes automatically in the live diff view. Describe what you changed in your reply.',
        'If channels are not available, the user may ask you to poll for comments or set up a loop. Use poll_comments to check for pending comments from the UI.'
      ].join(' ')
    }
  )

  // Tools

  let commentsSubscribed = false

  mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: COMMENTS_RESOURCE_URI,
      name: 'Pending review comments',
      description: 'Unanswered comments from the Marginalia browser review UI.',
      mimeType: 'text/plain'
    }]
  }))

  mcp.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => ({
    contents: [{
      uri: params.uri,
      mimeType: 'text/plain',
      text: params.uri === COMMENTS_RESOURCE_URI
        ? mailbox.read() || '(no pending comments)'
        : '(unknown resource)'
    }]
  }))

  mcp.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    if (params.uri === COMMENTS_RESOURCE_URI) commentsSubscribed = true
    return {}
  })

  mcp.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    if (params.uri === COMMENTS_RESOURCE_URI) commentsSubscribed = false
    return {}
  })

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'start',
        description: 'Start the marginalia review server. All parameters are optional and have sensible defaults. Only set parameters the user explicitly asked for.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            dir: { type: 'string', description: 'Directory to watch for changes. Defaults to the current working directory.' },
            port: { type: 'number', description: 'Port number. Defaults to a random available port (or MARGINALIA_PORT env var).' },
            host: { type: 'string', description: 'Listen address. Defaults to 127.0.0.1 (or MARGINALIA_HOST env var).' }
          }
        }
      },
      {
        name: 'stop',
        description: 'Stop the marginalia review server.',
        inputSchema: {
          type: 'object' as const,
          properties: {}
        }
      },
      {
        name: 'reply',
        description: 'Reply to a review comment thread in the marginalia UI. Supports markdown. Set ephemeral:true for a temporary status message that gets replaced by the next non-ephemeral reply.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            thread_id: { type: 'string', description: 'The thread_id from the original comment' },
            text: { type: 'string', description: 'Your response text (supports markdown)' },
            ephemeral: { type: 'boolean', description: 'If true, this is a temporary status that gets replaced by the next reply' }
          },
          required: ['thread_id', 'text']
        }
      },
      {
        name: 'get_url',
        description: 'Get the URL of the marginalia review UI.',
        inputSchema: {
          type: 'object' as const,
          properties: {}
        }
      },
      {
        name: 'show_context',
        description: 'Show a code snippet in the marginalia UI for context. Use when the user asks to see related code, call sites, definitions, etc.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            file: { type: 'string', description: 'File path relative to the project root' },
            startLine: { type: 'number', description: 'First line to show (1-based)' },
            endLine: { type: 'number', description: 'Last line to show (1-based)' },
            label: { type: 'string', description: 'Short description of why this snippet is relevant' }
          },
          required: ['file', 'startLine', 'endLine']
        }
      },
      {
        name: 'poll_comments',
        description: 'Check for pending review comments from the marginalia UI. Returns formatted comments or empty string if none. Use this when channels are not available.',
        inputSchema: {
          type: 'object' as const,
          properties: {}
        }
      }
    ]
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case 'start': {
        const parsed = parseArgs(StartArgs, req.params.arguments ?? {})
        if (!parsed.ok) return { content: [{ type: 'text', text: `error: ${parsed.error}` }] }
        try {
          const url = await startServer(parsed.data)
          return { content: [{ type: 'text', text: `marginalia started at ${url}` }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `failed to start: ${err instanceof Error ? err.message : err}` }] }
        }
      }
      case 'stop': {
        if (!isRunning()) {
          return { content: [{ type: 'text', text: 'marginalia is not running' }] }
        }
        await stopServer()
        return { content: [{ type: 'text', text: 'marginalia stopped' }] }
      }
      case 'reply': {
        if (!isRunning()) {
          return { content: [{ type: 'text', text: 'marginalia is not running, start it first' }] }
        }
        const parsed = parseArgs(ReplyArgs, req.params.arguments)
        if (!parsed.ok) return { content: [{ type: 'text', text: `error: ${parsed.error}` }] }
        const { thread_id, text, ephemeral } = parsed.data
        broadcast({ type: 'reply', thread_id, text, ephemeral })
        if (!ephemeral) mailbox.acknowledgeThread(thread_id)
        return { content: [{ type: 'text', text: `replied to ${thread_id}${ephemeral ? ' (ephemeral)' : ''}` }] }
      }
      case 'get_url': {
        if (!isRunning()) {
          return { content: [{ type: 'text', text: 'marginalia is not running' }] }
        }
        return { content: [{ type: 'text', text: getUrl() }] }
      }
      case 'show_context': {
        if (!isRunning()) {
          return { content: [{ type: 'text', text: 'marginalia is not running, start it first' }] }
        }
        const parsed = parseArgs(ShowContextArgs, req.params.arguments)
        if (!parsed.ok) return { content: [{ type: 'text', text: `error: ${parsed.error}` }] }
        const { file, startLine, endLine, label } = parsed.data
        try {
          const fullPath = join(getProjectDir(), file)
          const content = await readFile(fullPath, 'utf-8')
          const lines = content.split('\n').slice(startLine - 1, endLine)
          broadcast({ type: 'context', file, startLine, endLine, label: label ?? '', lines: lines.join('\n') })
          return { content: [{ type: 'text', text: `showed ${file}:${startLine}-${endLine} in UI` }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `failed to read ${file}: ${err}` }] }
        }
      }
      case 'poll_comments': {
        const comments = mailbox.drain()
        return { content: [{ type: 'text', text: comments || '(no pending comments)' }] }
      }
      default:
        throw new Error(`unknown tool: ${req.params.name}`)
    }
  })

  // Permission relay

  const PermissionRequestSchema = z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string()
    })
  })

  mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
    broadcast({
      type: 'permission',
      request_id: params.request_id,
      tool_name: params.tool_name,
      description: params.description,
      input_preview: params.input_preview
    })
  })

  return {
    server: mcp,
    publishComment(content: string, meta: Record<string, string>): void {
      mailbox.add({ content, meta })
      if (!commentsSubscribed) {
        deliver(mcp, content, meta)
        return
      }
      void mcp.sendResourceUpdated({ uri: COMMENTS_RESOURCE_URI }).catch(err => {
        process.stderr.write(`marginalia: failed to notify comment resource update: ${err instanceof Error ? err.message : err}\n`)
      })
    }
  }
}

function deliver(mcp: Server, content: string, meta: Record<string, string>): void {
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta }
  })
}
