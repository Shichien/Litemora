// 在后台线程里用 redstone-rs 的 WASM 构建模拟上传的原理图：操作指定的开关，
// 把结果录成回放并预处理成 RedstoneReplayController 直接能播的时间线。
import { getPackedReplayTransferables, packRedstoneReplay } from '../redstone-replay-data.js'
import initRedstoneWasm, { RedstoneSim } from './pkg/redstone_wasm.js'
import { simulatorFromWasm } from './switch-animation.js'
import { recordSwitchReplay, translateSimulator } from './switch-recorder.js'

const FORMAT_BY_EXTENSION = { litematic: 'litematic', schem: 'schem' }

let wasmReady = null

function resolveFormat(fileName = '') {
  const extension = String(fileName || '').trim().toLowerCase().split('.').pop()
  const format = FORMAT_BY_EXTENSION[extension]
  if (!format) {
    throw new Error(`红石模拟只支持 .litematic 和 .schem，收到 ${fileName || '未知文件'}`)
  }
  return format
}

globalThis.addEventListener('message', async (event) => {
  const { id, buffer, fileName, position, initialState, recording, durationTicks, title } = event.data || {}
  let native = null
  try {
    wasmReady ||= initRedstoneWasm()
    await wasmReady

    // strict=false：模拟器没有实现主动行为的方块保持静止，而不是拒绝整个原理图
    const format = resolveFormat(fileName)
    native = new RedstoneSim(new Uint8Array(buffer), format, false)
    const info = JSON.parse(native.info())
    // 开关坐标和回放坐标都用渲染器（schematic-renderer）的坐标系。.litematic 两边一致；
    // .schem 在渲染器里从 (0, 0, 0) 起算，模拟器则从结构区域的最小角起算。
    const [regionX = 0, regionY = 0, regionZ = 0] = format === 'schem' ? (info.regionMin || []) : []
    const sim = translateSimulator(simulatorFromWasm(native), { x: -regionX, y: -regionY, z: -regionZ })
    const { control, replay, switchType, normalizedWireConnections, unsupportedEvents } = recordSwitchReplay(sim, {
      position,
      initialState,
      recording,
      durationTicks,
      title,
      dataVersion: info.dataVersion ?? null,
    })

    const packed = packRedstoneReplay(replay)
    globalThis.postMessage({
      id,
      ok: true,
      packed,
      control,
      summary: {
        switchType,
        sourceRelease: info.sourceRelease,
        minecraftVersion: replay.minecraftVersion,
        normalizedWireConnections,
        unsupportedEvents,
        mode: control.mode || control.type,
        segments: control.segments,
        totalTicks: replay.totalTicks,
        changeCount: replay.changeCount,
        // 方块名 -> 数量：这些方块在模拟里不会动
        unsupportedBlocks: info.unsupported || {},
      },
    }, getPackedReplayTransferables(packed))
  }
  catch (error) {
    globalThis.postMessage({
      id,
      ok: false,
      code: String(error?.code || 'simulation_failed'),
      message: String(error?.message || error),
    })
  }
  finally {
    native?.free?.()
  }
})
