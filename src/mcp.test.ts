import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { CommentMailbox, COMMENTS_RESOURCE_URI } from './comments.js'
import { createMcpServer } from './mcp.js'

const ChannelNotificationSchema = z.object({
  method: z.literal('notifications/claude/channel'),
  params: z.object({
    content: z.string(),
    meta: z.record(z.string(), z.string())
  })
})

test('comments resource notifies subscribers and replies acknowledge delivery', async () => {
  const mailbox = new CommentMailbox()
  const broadcasts: Array<Record<string, unknown>> = []
  const { server, publishComment } = createMcpServer({
    broadcast: message => { broadcasts.push(message) },
    getUrl: () => 'http://127.0.0.1:3456',
    getProjectDir: () => '.',
    mailbox,
    version: 'test',
    startServer: async () => 'http://127.0.0.1:3456',
    stopServer: async () => {},
    isRunning: () => true
  })
  const client = new Client({ name: 'marginalia-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  let resolveUpdate!: (uri: string) => void
  const update = new Promise<string>(resolve => { resolveUpdate = resolve })
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => {
    resolveUpdate(params.uri)
  })
  let channelNotifications = 0
  client.setNotificationHandler(ChannelNotificationSchema, () => {
    channelNotifications++
  })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  try {
    const listed = await client.listResources()
    assert.deepEqual(listed.resources.map(resource => resource.uri), [COMMENTS_RESOURCE_URI])

    await client.subscribeResource({ uri: COMMENTS_RESOURCE_URI })
    publishComment('Please review this.', { type: 'general', thread_id: 't_1' })
    assert.equal(await update, COMMENTS_RESOURCE_URI)
    assert.equal(channelNotifications, 0)

    const firstRead = await client.readResource({ uri: COMMENTS_RESOURCE_URI })
    const firstContent = firstRead.contents[0]
    assert.ok(firstContent && 'text' in firstContent)
    assert.match(firstContent.text, /Please review this\./)
    assert.match(firstContent.text, /message_id="1"/)

    await client.callTool({
      name: 'reply',
      arguments: { thread_id: 't_1', message_id: 1, text: 'Looking into this.', ephemeral: true }
    })
    assert.equal(mailbox.read(), '')

    await client.callTool({
      name: 'reply',
      arguments: { thread_id: 't_1', message_id: 1, text: 'Done.' }
    })
    assert.equal(mailbox.read(), '')
    assert.deepEqual(broadcasts, [
      { type: 'reply', thread_id: 't_1', text: 'Looking into this.', ephemeral: true },
      { type: 'reply', thread_id: 't_1', text: 'Done.', ephemeral: false }
    ])
  } finally {
    await client.close()
    await server.close()
  }
})

test('poll_comments remains a draining fallback', async () => {
  const mailbox = new CommentMailbox()
  const { server, publishComment } = createMcpServer({
    broadcast: () => {},
    getUrl: () => '',
    getProjectDir: () => '.',
    mailbox,
    version: 'test',
    startServer: async () => '',
    stopServer: async () => {},
    isRunning: () => false
  })
  const client = new Client({ name: 'marginalia-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  let resolveChannel!: (params: z.infer<typeof ChannelNotificationSchema>['params']) => void
  const channel = new Promise<z.infer<typeof ChannelNotificationSchema>['params']>(
    resolve => { resolveChannel = resolve }
  )
  client.setNotificationHandler(ChannelNotificationSchema, ({ params }) => {
    resolveChannel(params)
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  publishComment('Fallback comment', { type: 'general', thread_id: 't_1' })
  assert.deepEqual(await channel, {
    content: 'Fallback comment',
    meta: { type: 'general', thread_id: 't_1', message_id: '1' }
  })

  try {
    const first = CallToolResultSchema.parse(await client.callTool({ name: 'poll_comments', arguments: {} }))
    const second = CallToolResultSchema.parse(await client.callTool({ name: 'poll_comments', arguments: {} }))
    assert.equal(first.content[0]?.type, 'text')
    assert.equal(second.content[0]?.type, 'text')
    assert.match(first.content[0]?.type === 'text' ? first.content[0].text : '', /Fallback comment/)
    assert.equal(second.content[0]?.type === 'text' ? second.content[0].text : '', '(no pending comments)')
  } finally {
    await client.close()
    await server.close()
  }
})
