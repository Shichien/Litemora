import { ReplayModError } from './replaymod-binary.js'

export { SUPPORTED_REPLAYMOD_VERSIONS } from './replaymod-data.js'

/** Parse off the UI thread. The input buffer is transferred to the worker. */
export function loadReplayMod(input, { onProgress, signal, limits } = {}) {
  if (signal?.aborted) {
    const error = new Error('Replay import was cancelled')
    error.name = 'AbortError'
    return Promise.reject(error)
  }
  if (typeof Worker === 'undefined')
    return import('./replaymod-parser.js').then(({ parseReplayMod }) => parseReplayMod(input, { onProgress, signal, limits }))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./replaymod-worker.js', import.meta.url), { type: 'module' })
    let settled = false
    function finish(error, result) {
      if (settled)
        return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error)
        reject(error)
      else resolve(result)
    }
    function abort() {
      const error = new Error('Replay import was cancelled')
      error.name = 'AbortError'
      finish(error)
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress')
        onProgress?.(data.progress)
      else if (data.type === 'result')
        finish(null, data.result)
      else if (data.type === 'error')
        finish(new ReplayModError(data.message, data.code))
    }
    worker.onerror = event => finish(new ReplayModError(event.message || 'Replay decoder worker failed', 'WORKER_ERROR'))
    worker.onmessageerror = () => finish(new ReplayModError('Replay worker returned invalid data', 'WORKER_ERROR'))
    try {
      const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null
      if (!bytes)
        throw new ReplayModError('Replay input must be an ArrayBuffer or Uint8Array')
      const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer ? bytes : bytes.slice()
      worker.postMessage({ input: owned, limits }, [owned.buffer])
    }
    catch (error) {
      finish(error)
    }
  })
}
