import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export type BroadcastFn = (msg: Record<string, unknown>) => void

export function createMcpServer(broadcast: BroadcastFn, getUrl: () => string, version: string) {
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
        'Marginalia is a live code review UI. If the user asks for the URL, call get_url.',
        'Code review comments arrive as <channel source="marginalia" ...>.',
        'Inline comments have file, line, and side attributes indicating the exact code location.',
        'General comments have type="general". Thread replies have type="thread_reply".',
        'IMPORTANT: Only use the reply tool when responding to <channel source="marginalia"> messages.',
        'The user may also type directly in the terminal. If a message does NOT come from a <channel> tag, respond normally in the terminal.',
        'When you DO get a marginalia channel message, respond ONLY via the reply tool with the matching thread_id. Do not duplicate your response in the terminal.',
        'Replies support markdown.',
        'Before taking action on a review comment, send an ephemeral reply (ephemeral:true) like "Looking into this..." so the user sees you are working on it. Then send the real reply when done.',
        'When you edit files in response to review feedback, the reviewer sees changes',
        'automatically in the live diff view. Describe what you changed in your reply.'
      ].join(' ')
    }
  )

  // Tools

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
        description: 'Get the URL of the marginalia review UI. Use this to tell the user where to open their browser.',
        inputSchema: {
          type: 'object' as const,
          properties: {}
        }
      }
    ]
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case 'reply': {
        const { thread_id, text, ephemeral } = req.params.arguments as { thread_id: string; text: string; ephemeral?: boolean }
        broadcast({ type: 'reply', thread_id, text, ephemeral: !!ephemeral })
        return { content: [{ type: 'text', text: `replied to ${thread_id}${ephemeral ? ' (ephemeral)' : ''}` }] }
      }
      case 'get_url': {
        return { content: [{ type: 'text', text: getUrl() || 'server not yet started' }] }
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
