import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export type BroadcastFn = (msg: Record<string, unknown>) => void

interface McpOptions {
  broadcast: BroadcastFn
  getUrl: () => string
  version: string
  startServer: (opts?: { dir?: string; port?: number; host?: string }) => Promise<string>
  stopServer: () => Promise<void>
  isRunning: () => boolean
}

export function createMcpServer(opts: McpOptions) {
  const { broadcast, getUrl, version, startServer, stopServer, isRunning } = opts

  const mcp = new Server(
    { name: 'marginalia', version },
    {
      capabilities: {
        tools: {},
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
        'Code review comments arrive as <channel source="marginalia" ...>.',
        'Inline comments have file, line, and side attributes. General comments have type="general". Thread replies have type="thread_reply".',
        'IMPORTANT: Only use the reply tool when responding to <channel source="marginalia"> messages.',
        'If a message does NOT come from a <channel> tag, respond normally in the terminal.',
        'When you get a marginalia channel message, respond ONLY via the reply tool with the matching thread_id. Do not duplicate your response in the terminal.',
        'Replies support markdown.',
        'Before taking action on a review comment, send an ephemeral reply (ephemeral:true) so the user sees you are working on it. Then send the real reply when done.',
        'When you edit files in response to review feedback, the reviewer sees changes automatically in the live diff view. Describe what you changed in your reply.'
      ].join(' ')
    }
  )

  // Tools

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
      }
    ]
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case 'start': {
        const args = (req.params.arguments ?? {}) as { dir?: string; port?: number; host?: string }
        const url = await startServer(args)
        return { content: [{ type: 'text', text: `marginalia started at ${url}` }] }
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
        const { thread_id, text, ephemeral } = req.params.arguments as { thread_id: string; text: string; ephemeral?: boolean }
        broadcast({ type: 'reply', thread_id, text, ephemeral: !!ephemeral })
        return { content: [{ type: 'text', text: `replied to ${thread_id}${ephemeral ? ' (ephemeral)' : ''}` }] }
      }
      case 'get_url': {
        if (!isRunning()) {
          return { content: [{ type: 'text', text: 'marginalia is not running' }] }
        }
        return { content: [{ type: 'text', text: getUrl() }] }
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

  return mcp
}

export function deliver(mcp: Server, content: string, meta: Record<string, string>): void {
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta }
  })
}
