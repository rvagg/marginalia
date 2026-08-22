import type { EventEmitter } from 'node:events'

type ParentInput = EventEmitter & Pick<NodeJS.ReadStream, 'readableEnded' | 'destroyed'>
type ParentOutput = EventEmitter

export function watchParentDisconnect(
  input: ParentInput,
  output: ParentOutput,
  errorOutput: ParentOutput,
  onDisconnect: () => void
): void {
  let disconnected = false
  const disconnect = () => {
    if (disconnected) return
    disconnected = true
    onDisconnect()
  }

  input.once('end', disconnect)
  input.once('close', disconnect)
  input.once('error', disconnect)
  output.once('error', disconnect)
  errorOutput.once('error', disconnect)

  if (input.readableEnded || input.destroyed) disconnect()
}
