import { fetchRedstoneReplay, packRedstoneReplay } from './redstone-replay-data.js'

// worker 本身起不来（脚本加载失败、浏览器不支持等）时退回主线程处理
class ReplayWorkerUnavailableError extends Error {}

function loadInWorker(absoluteUrl) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./redstone-replay.worker.js', import.meta.url), { type: 'module' })
    }
    catch (error) {
      reject(new ReplayWorkerUnavailableError(String(error?.message || error)))
      return
    }

    const finish = (callback) => {
      worker.terminate()
      callback()
    }
    worker.addEventListener('message', (event) => {
      const data = event.data || {}
      finish(() => (data.ok ? resolve(data.packed) : reject(new Error(data.message || '红石回放载入失败'))))
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault?.()
      finish(() => reject(new ReplayWorkerUnavailableError(event.message || 'replay_worker_error')))
    })
    worker.postMessage({ id: 1, url: absoluteUrl })
  })
}

/** 下载并预处理回放，结果是 packRedstoneReplay() 的格式 */
export async function loadRedstoneReplayTimeline(replayUrl) {
  const absoluteUrl = new URL(replayUrl, globalThis.location?.href).href
  if (typeof Worker === 'function') {
    try {
      return await loadInWorker(absoluteUrl)
    }
    catch (error) {
      if (!(error instanceof ReplayWorkerUnavailableError)) {
        throw error
      }
      console.warn('[RedstoneReplay] Worker unavailable, parsing on main thread:', error.message)
    }
  }
  return packRedstoneReplay(await fetchRedstoneReplay(absoluteUrl))
}
