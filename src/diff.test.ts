import assert from 'node:assert/strict'
import { execFile as execFileCb } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { getCurrentDiff } from './diff.js'

const execFile = promisify(execFileCb)

async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'marginalia-test-'))
  try {
    await execFile('git', ['init'], { cwd: dir })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFile('git', ['config', 'user.name', 'Marginalia Test'], { cwd: dir })
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('getCurrentDiff includes tracked and untracked changes without touching real index', async () => {
  await withRepo(async (dir) => {
    await writeFile(join(dir, 'tracked.txt'), 'one\n')
    await execFile('git', ['add', 'tracked.txt'], { cwd: dir })
    await execFile('git', ['commit', '-m', 'initial'], { cwd: dir })

    await writeFile(join(dir, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(dir, 'untracked.txt'), 'new\n')

    const diff = await getCurrentDiff(dir)
    const { stdout: staged } = await execFile('git', ['diff', '--cached', '--name-only'], { cwd: dir })

    assert.match(diff, /diff --git a\/tracked\.txt b\/tracked\.txt/)
    assert.match(diff, /diff --git a\/untracked\.txt b\/untracked\.txt/)
    assert.equal(staged, '')
  })
})

test('getCurrentDiff works in a repo with no commits', async () => {
  await withRepo(async (dir) => {
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'new.txt'), 'new\n')

    const diff = await getCurrentDiff(dir)

    assert.match(diff, /diff --git a\/src\/new\.txt b\/src\/new\.txt/)
    assert.match(diff, /new file mode/)
  })
})

test('getCurrentDiff rejects outside a git repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marginalia-not-repo-'))
  try {
    await assert.rejects(() => getCurrentDiff(dir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
