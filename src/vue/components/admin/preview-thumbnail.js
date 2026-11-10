// Do not await between render() and drawImage(): WebGL buffers need not survive
// browser compositing (even though schematic-renderer 1.1.23 preserves its buffer).
export function captureRenderedThumbnail(renderer, sourceCanvas, options = {}, createCanvas = () => document.createElement('canvas')) {
  const manager = renderer?.renderManager
  const gl = manager?.renderer?.getContext?.()
  if (!manager || typeof manager.render !== 'function' || manager.disposed || manager.contextLost
    || manager.isRendering || !gl || gl.isContextLost()
    || !sourceCanvas?.width || !sourceCanvas?.height) {
    throw new Error('渲染画布尚未就绪或 WebGL 上下文已丢失')
  }
  const width = Math.max(1, Math.round(Number(options.width || 640)))
  const height = Math.max(1, Math.round(Number(options.height || 360)))
  const quality = Math.min(0.95, Math.max(0.5, Number(options.quality || 0.82)))
  const canvas = createCanvas()
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('无法创建封面画布')

  // render() catches errors internally; observe them so a stale frame cannot pass.
  let renderError = null
  const onError = (event) => {
    renderError = event?.error || new Error('封面渲染失败')
  }
  manager.eventEmitter?.on('renderError', onError)
  try {
    manager.render()
    if (renderError)
      throw renderError
    if (manager.contextLost || gl.isContextLost())
      throw new Error('WebGL 上下文已丢失')
    const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height)
    const drawWidth = sourceCanvas.width * scale
    const drawHeight = sourceCanvas.height * scale
    // Validate before adding the letterbox background: transparent/solid frames
    // must not become apparently valid JPEGs simply because they have a data URL.
    context.drawImage(sourceCanvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    const { data } = context.getImageData(0, 0, width, height)
    let first = -1
    let varied = false
    const stride = Math.max(1, Math.floor(width * height / 4096)) * 4
    for (let index = 0; index < data.length; index += stride) {
      if (data[index + 3] < 250)
        continue
      if (first < 0) {
        first = index
      }
      else if (Math.abs(data[index] - data[first]) > 2
        || Math.abs(data[index + 1] - data[first + 1]) > 2
        || Math.abs(data[index + 2] - data[first + 2]) > 2) {
        varied = true
        break
      }
    }
    if (!varied)
      throw new Error('封面画面为空白，请等待真实模型显示后重试')
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#081219'
    context.fillRect(0, 0, width, height)
    const result = canvas.toDataURL('image/jpeg', quality)
    if (!result.startsWith('data:image/jpeg;base64,') || result.length < 100)
      throw new Error('封面编码失败')
    return result
  }
  finally {
    manager.eventEmitter?.off('renderError', onError)
  }
}

export async function waitForThumbnailReady(isReady, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (!isReady()) {
    if (Date.now() >= deadline)
      throw new Error('真实预览尚未就绪，请保持页面可见并稍后重试')
    // Timers, unlike rAF, still settle in background tabs (subject to throttling).
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
  }
}
