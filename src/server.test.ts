import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { watchParentDisconnect } from './lifecycle.js'

test('parent stdio failure triggers one disconnect', () => {
  for (const failedStream of ['input', 'output', 'errorOutput'] as const) {
    const input = new PassThrough()
    const output = new PassThrough()
    const errorOutput = new PassThrough()
    let disconnects = 0

    watchParentDisconnect(input, output, errorOutput, () => { disconnects++ })
    const stream = { input, output, errorOutput }[failedStream]
    stream.emit('error', new Error(`${failedStream} disconnected`))

    input.emit('end')
    input.emit('close')
    assert.equal(disconnects, 1, failedStream)
  }
})

test('already closed parent input disconnects synchronously', () => {
  const input = new PassThrough()
  input.destroy()
  let disconnects = 0

  watchParentDisconnect(input, new PassThrough(), new PassThrough(), () => { disconnects++ })

  assert.equal(disconnects, 1)
})
