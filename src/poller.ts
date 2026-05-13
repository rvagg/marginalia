export interface DiffPoller {
  start: () => void
  stop: () => void
}

export interface DiffPollerOptions {
  intervalMs: number
  getProjectDir: () => string
  getCurrentDiff: (projectDir: string) => Promise<string>
  getLastDiff: () => string
  setLastDiff: (diff: string) => void
  hasClients: () => boolean
  broadcast: (msg: Record<string, unknown>) => void
  log?: (msg: string) => void
}

export function createDiffPoller(opts: DiffPollerOptions): DiffPoller {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let stopped = true

  async function tick(): Promise<void> {
    if (stopped) return

    if (!opts.hasClients()) {
      schedule()
      return
    }

    if (running) {
      opts.log?.('marginalia: skipping diff poll because previous poll is still running\n')
      schedule()
      return
    }

    running = true
    try {
      const diff = await opts.getCurrentDiff(opts.getProjectDir())
      if (!stopped && diff !== opts.getLastDiff()) {
        opts.setLastDiff(diff)
        opts.broadcast({ type: 'diff', diff })
      }
    } catch (err) {
      opts.log?.(`marginalia: diff poll failed: ${err instanceof Error ? err.message : err}\n`)
    } finally {
      running = false
      schedule()
    }
  }

  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => { void tick() }, opts.intervalMs)
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      schedule()
    },
    stop() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
