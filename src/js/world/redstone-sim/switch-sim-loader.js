import { SwitchSimulationError } from './switch-recorder.js'

/**
 * 在 worker 里模拟原理图并录下「操作开关」的回放。
 *
 * @param {object} options
 * @param {ArrayBuffer} options.buffer 原理图源文件；会被转移给 worker，调用方需要的话请先拷贝
 * @param {string} options.fileName 用来判断格式（.litematic / .schem）
 * @param {{x:number,y:number,z:number}} options.position 开关坐标（原理图局部坐标）
 * @param {'open'|'closed'} [options.initialState]
 * @param {'door'|'machine'} [options.recording] 开关门或定长机器演示
 * @param {number} [options.durationTicks] 录制游戏刻数
 * @param {string} [options.title] 回放标题
 * @returns {Promise<{ packed: object, control: object, summary: object }>}
 *   packed 是 packRedstoneReplay() 的格式，control 等同于投影条目的 redstoneControl
 */
export function simulateSwitchReplay({ buffer, fileName = '', position, initialState = 'closed', recording = 'door', durationTicks, title = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!(buffer instanceof ArrayBuffer)) {
      reject(new SwitchSimulationError('missing_source', '原理图源文件不可用，无法模拟开关'))
      return
    }
    if (typeof Worker !== 'function') {
      reject(new SwitchSimulationError('worker_unavailable', '当前浏览器不支持后台红石模拟'))
      return
    }

    let worker
    try {
      worker = new Worker(new URL('./redstone-sim.worker.js', import.meta.url), { type: 'module' })
    }
    catch (error) {
      reject(new SwitchSimulationError('worker_unavailable', String(error?.message || error)))
      return
    }

    const finish = (callback) => {
      worker.terminate()
      callback()
    }
    worker.addEventListener('message', (event) => {
      const data = event.data || {}
      finish(() => (data.ok
        ? resolve({ packed: data.packed, control: data.control, summary: data.summary })
        : reject(new SwitchSimulationError(data.code || 'simulation_failed', data.message || '红石模拟失败'))))
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault?.()
      finish(() => reject(new SwitchSimulationError('worker_unavailable', event.message || '红石模拟线程启动失败')))
    })
    worker.postMessage({ id: 1, buffer, fileName, position, initialState, recording, durationTicks, title }, [buffer])
  })
}
