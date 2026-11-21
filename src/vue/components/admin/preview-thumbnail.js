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
  const scene = renderer.sceneManager.scene
  const background = scene.background
  const clearAlpha = manager.renderer.getClearAlpha()
  manager.eventEmitter?.on('renderError', onError)
  try {
    scene.background = null
    manager.renderer.setClearAlpha(0)
    manager.render()
    if (renderError)
      throw renderError
    if (manager.contextLost || gl.isContextLost())
      throw new Error('WebGL 上下文已丢失')
    const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height)
    const drawWidth = sourceCanvas.width * scale
    const drawHeight = sourceCanvas.height * scale
    context.drawImage(sourceCanvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    const { data } = context.getImageData(0, 0, width, height)
    // Include alpha so a single flat face or translucent glass against air counts.
    const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    if (!pixels.some(pixel => pixel !== pixels[0]))
      throw new Error('封面画面为空白，请等待真实模型显示后重试')
    const result = canvas.toDataURL('image/webp', quality)
    // Browsers without a WebP encoder produce PNG, which also preserves alpha.
    if (!/^data:image\/(?:webp|png);base64,/.test(result) || result.length < 100)
      throw new Error('封面编码失败')
    return result
  }
  finally {
    scene.background = background
    manager.renderer.setClearAlpha(clearAlpha)
    manager.eventEmitter?.off('renderError', onError)
    manager.requestRender()
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
