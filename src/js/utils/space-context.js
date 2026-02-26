const ROOT_DOMAIN = 'litemora.art'
const SPACE_NAME_REGEX = /^[a-z0-9-]{3,63}$/

function normalizeHost(hostname = window.location.hostname) {
  return String(hostname || '').trim().toLowerCase()
}

export function normalizeSpaceName(rawName = '') {
  return String(rawName || '').trim().toLowerCase()
}

export function isValidSpaceName(rawName = '') {
  const name = normalizeSpaceName(rawName)
  return SPACE_NAME_REGEX.test(name)
}

export function isRootPortalHost(hostname = window.location.hostname) {
  const host = normalizeHost(hostname)
  return host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`
}

export function isLocalDevHost(hostname = window.location.hostname) {
  const host = normalizeHost(hostname)
  return host === 'localhost' || host === '127.0.0.1'
}

export function getSpaceNameFromHost(hostname = window.location.hostname) {
  const host = normalizeHost(hostname)

  if (!host || isRootPortalHost(host)) {
    return ''
  }

  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    const label = host.slice(0, -(ROOT_DOMAIN.length + 1))
    const firstLabel = label.split('.').filter(Boolean)[0] || ''
    return isValidSpaceName(firstLabel) ? firstLabel : ''
  }

  return ''
}

export function getSpaceNameFromPathname(pathname = window.location.pathname) {
  const rawPath = String(pathname || '/').trim()
  const segments = rawPath.split('/').filter(Boolean)
  if (!segments.length) {
    return ''
  }

  const firstSegment = decodeURIComponent(segments[0] || '').toLowerCase()
  return isValidSpaceName(firstSegment) ? firstSegment : ''
}

export function getActiveSpaceName() {
  const fromPath = getSpaceNameFromPathname()
  if (fromPath) {
    return fromPath
  }

  const fromHost = getSpaceNameFromHost()
  if (fromHost) {
    return fromHost
  }

  const fromQuery = new URLSearchParams(window.location.search).get('space') || ''
  return isValidSpaceName(fromQuery) ? normalizeSpaceName(fromQuery) : ''
}

export function buildSpaceUrl(spaceName) {
  const normalized = normalizeSpaceName(spaceName)
  if (!isValidSpaceName(normalized)) {
    throw new Error('invalid_space_name')
  }

  const url = new URL(window.location.origin)
  url.pathname = `/${normalized}`
  url.search = ''
  return url.toString()
}

export function shouldUseRootPortalView() {
  return !getActiveSpaceName()
}

export function buildSpaceScopedKey(baseKey, scope = '') {
  const key = String(baseKey || '').trim()
  if (!key) {
    return ''
  }

  const activeScope = normalizeSpaceName(scope || getActiveSpaceName())
  if (!activeScope) {
    return key
  }

  return `${key}:space:${encodeURIComponent(activeScope)}`
}
