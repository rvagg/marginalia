import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getAgentDisplayName } from './http.js'

test('agent display name uses the MCP client identity', () => {
  assert.equal(getAgentDisplayName('omp-coding-agent'), 'omp-coding-agent')
  assert.equal(getAgentDisplayName('Claude Code'), 'claude')
  assert.equal(getAgentDisplayName(undefined), 'agent')
  assert.equal(getAgentDisplayName('   '), 'agent')
})

test('agent display name is bounded', () => {
  assert.equal(getAgentDisplayName('x'.repeat(100)), 'x'.repeat(48))
})
