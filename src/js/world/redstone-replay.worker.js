// 在后台线程下载、解压、解析并预处理红石回放，避免主线程卡顿。
import { fetchRedstoneReplay, getPackedReplayTransferables, packRedstoneReplay } from './redstone-replay-data.js'

globalThis.addEventListener('message', async (event) => {
  const { id, url } = event.data || {}
  try {
    const packed = packRedstoneReplay(await fetchRedstoneReplay(url))
    globalThis.postMessage({ id, ok: true, packed }, getPackedReplayTransferables(packed))
  }
  catch (error) {
    globalThis.postMessage({ id, ok: false, message: String(error?.message || error) })
  }
})
