export function navigateToUrl(targetUrl, options = {}) {
  const url = String(targetUrl || '').trim()
  if (!url) {
    return
  }

  const { replace = false } = options
  const method = replace ? 'replaceState' : 'pushState'
  window.history[method]({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
