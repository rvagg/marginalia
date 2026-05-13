import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDiffPoller } from './poller.js'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('diff poller does not run without clients', async () => {
  let calls = 0
  const poller = createDiffPoller({
    intervalMs: 5,
    getProjectDir: () => '.',
    getCurrentDiff: async () => {
      calls++
      return ''
    },
    getLastDiff: () => '',
    setLastDiff: () => {},
    hasClients: () => false,
    broadcast: () => {}
  })

  poller.start()
  await delay(30)
  poller.stop()

  assert.equal(calls, 0)
})

test('diff poller waits for a slow poll before scheduling another', async () => {
  let inFlight = 0
  let maxInFlight = 0
  let calls = 0

  const poller = createDiffPoller({
    intervalMs: 5,
    getProjectDir: () => '.',
    getCurrentDiff: async () => {
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(25)
      inFlight--
      return ''
    },
    getLastDiff: () => '',
    setLastDiff: () => {},
    hasClients: () => true,
    broadcast: () => {}
  })

  poller.start()
  await delay(80)
  poller.stop()

  assert.equal(maxInFlight, 1)
  assert.ok(calls <= 3, `expected at most 3 polls, got ${calls}`)
})

test('diff poller broadcasts changed diffs', async () => {
  let lastDiff = 'old'
  const broadcasts: Array<Record<string, unknown>> = []

  const poller = createDiffPoller({
    intervalMs: 5,
    getProjectDir: () => '.',
    getCurrentDiff: async () => 'new',
    getLastDiff: () => lastDiff,
    setLastDiff: (diff) => { lastDiff = diff },
    hasClients: () => true,
    broadcast: (msg) => { broadcasts.push(msg) }
  })

  poller.start()
  await delay(20)
  poller.stop()

  assert.equal(lastDiff, 'new')
  assert.deepEqual(broadcasts[0], { type: 'diff', diff: 'new' })
})
