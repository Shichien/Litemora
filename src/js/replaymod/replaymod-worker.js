import { parseReplayMod } from './replaymod-parser.js'

function transferBuffers(value, buffers = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value))
    return buffers
  seen.add(value)
  if (ArrayBuffer.isView(value)) {
    buffers.add(value.buffer)
  }
  else if (value instanceof ArrayBuffer) {
    buffers.add(value)
  }
  else {
    for (const child of Object.values(value)) transferBuffers(child, buffers, seen)
  }
  return buffers
}

globalThis.onmessage = async ({ data }) => {
  try {
    const result = await parseReplayMod(data.input, {
      limits: data.limits,
      onProgress: progress => globalThis.postMessage({ type: 'progress', progress }),
    })
    globalThis.postMessage({ type: 'result', result }, [...transferBuffers(result)])
  }
  catch (error) {
    globalThis.postMessage({ type: 'error', message: error.message || String(error), code: error.code || 'INVALID_REPLAY' })
  }
}
