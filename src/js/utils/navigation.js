function resolveNavigationTarget(targetUrl = '') {
  const url = String(targetUrl || '').trim()
  if (!url) {
    return null
  }

  try {
    const resolved = new URL(url, window.location.origin)
    const protocol = String(resolved.protocol || '').toLowerCase()
    const isSameOrigin = resolved.origin === window.location.origin

    if (isSameOrigin) {
      return {
        type: 'internal',
        href: `${resolved.pathname}${resolved.search}${resolved.hash}`,
      }
    }

    if (protocol === 'http:' || protocol === 'https:') {
      return {
        type: 'external',
        href: resolved.toString(),
      }
    }
  }
  catch {
    return null
  }

  return null
}

export function navigateToUrl(targetUrl, options = {}) {
  const navigation = resolveNavigationTarget(targetUrl)
  if (!navigation) {
    return false
  }

  const { replace = false } = options

  if (navigation.type === 'external') {
    if (replace) {
      window.location.replace(navigation.href)
    }
    else {
      window.location.assign(navigation.href)
    }
    return true
  }

  const method = replace ? 'replaceState' : 'pushState'
  window.history[method]({}, '', navigation.href)
  window.dispatchEvent(new PopStateEvent('popstate'))
  return true
}
