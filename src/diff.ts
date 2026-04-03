import { execFile as execFileCb } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

let emptyTreeHash: string | null = null

async function getEmptyTreeHash(opts: { cwd: string }): Promise<string> {
  if (!emptyTreeHash) {
    const { stdout } = await execFile('git', ['hash-object', '-t', 'tree', '/dev/null'], opts)
    emptyTreeHash = stdout.trim()
  }
  return emptyTreeHash
}

export async function getCurrentDiff(projectDir: string): Promise<string> {
  const opts = { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 }
  try {
    let base: string
    try {
      await execFile('git', ['rev-parse', 'HEAD'], opts)
      base = 'HEAD'
    } catch {
      base = await getEmptyTreeHash(opts)
    }

    // Stage everything (including untracked, respecting .gitignore) into
    // a temporary index, diff that against the base, then discard it.
    // Leaves the real index untouched. PID-scoped to avoid contention
    // between concurrent instances on the same repo.
    const tmpIndex = join(tmpdir(), `marginalia-${process.pid}.idx`)
    const envWithIndex = { ...process.env, GIT_INDEX_FILE: tmpIndex }
    const tmpOpts = { ...opts, env: envWithIndex }

    try {
      await execFile('git', ['add', '--all'], tmpOpts)
      const { stdout } = await execFile('git', ['diff', '--cached', base], tmpOpts)
      return stdout
    } finally {
      try { await unlink(tmpIndex) } catch {}
    }
  } catch {
    return ''
  }
}
