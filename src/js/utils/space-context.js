const ROOT_DOMAIN = 'litemora.art'
const SPACE_NAME_REGEX = /^[a-z0-9-]{3,63}$/
const RESERVED_PATH_SEGMENTS = new Set(['gallery', 'api'])

function getPathSegments(pathname = window.location.pathname) {
  return String(pathname || '/').trim().split('/').filter(Boolean)
}

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
  const segments = getPathSegments(pathname)
  if (!segments.length) {
    return ''
  }

  const firstSegment = decodeURIComponent(segments[0] || '').toLowerCase()
  if (RESERVED_PATH_SEGMENTS.has(firstSegment)) {
    return ''
  }
  return isValidSpaceName(firstSegment) ? firstSegment : ''
}

export function isSpaceWorldsRoute(pathname = window.location.pathname) {
  const spaceName = getSpaceNameFromPathname(pathname)
  if (!spaceName) {
    return false
  }

  const segments = getPathSegments(pathname)
  if (segments.length !== 2) {
    return false
  }

  return decodeURIComponent(segments[1] || '').toLowerCase() === 'worlds'
}

export function isGalleryRoute(pathname = window.location.pathname) {
  const segments = getPathSegments(pathname)
  if (segments.length < 2) {
    return false
  }

  const section = decodeURIComponent(segments[0] || '').toLowerCase()
  const gallerySpaceName = decodeURIComponent(segments[1] || '').toLowerCase()
  return section === 'gallery' && isValidSpaceName(gallerySpaceName)
}

export function getSpaceProjectionIdFromPathname(pathname = window.location.pathname) {
  const spaceName = getSpaceNameFromPathname(pathname)
  if (!spaceName) {
    return ''
  }

  const segments = getPathSegments(pathname)
  if (segments.length < 3) {
    return ''
  }

  const section = decodeURIComponent(segments[1] || '').toLowerCase()
  if (section !== 'worlds') {
    return ''
  }

  return String(decodeURIComponent(segments[2] || '')).trim()
}

export function getWorldsProjectionIdFromSearch(search = window.location.search, pathname = window.location.pathname) {
  if (!isSpaceWorldsRoute(pathname)) {
    return ''
  }

  const projectionId = String(new URLSearchParams(search).get('projection') || '').trim()
  return projectionId
}

export function isSpaceProjectionRoute(pathname = window.location.pathname) {
  return !!getSpaceProjectionIdFromPathname(pathname)
}

export function getActiveProjectionId(pathname = window.location.pathname, search = window.location.search) {
  return getSpaceProjectionIdFromPathname(pathname) || getWorldsProjectionIdFromSearch(search, pathname)
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

export function buildSpaceWorldsUrl(spaceName) {
  const normalized = normalizeSpaceName(spaceName)
  if (!isValidSpaceName(normalized)) {
    throw new Error('invalid_space_name')
  }

  const url = new URL(window.location.origin)
  url.pathname = `/${normalized}/worlds`
  url.search = ''
  return url.toString()
}

export function buildSpaceWorldsAdminUrl(spaceName, projectionId = '') {
  const url = new URL(buildSpaceWorldsUrl(spaceName))
  const normalizedProjectionId = String(projectionId || '').trim()
  if (normalizedProjectionId) {
    url.searchParams.set('projection', normalizedProjectionId)
  }
  url.hash = 'admin-config'
  return url.toString()
}

export function buildGalleryUrl(spaceName) {
  const normalized = normalizeSpaceName(spaceName)
  if (!isValidSpaceName(normalized)) {
    throw new Error('invalid_space_name')
  }

  const url = new URL(window.location.origin)
  url.pathname = `/gallery/${normalized}`
  url.search = ''
  return url.toString()
}

export function buildSpaceProjectionUrl(spaceName, projectionId) {
  const normalized = normalizeSpaceName(spaceName)
  const normalizedProjectionId = String(projectionId || '').trim()
  if (!isValidSpaceName(normalized)) {
    throw new Error('invalid_space_name')
  }
  if (!normalizedProjectionId) {
    throw new Error('invalid_projection_id')
  }

  const url = new URL(window.location.origin)
  url.pathname = `/${normalized}/worlds/${encodeURIComponent(normalizedProjectionId)}`
  url.search = ''
  return url.toString()
}

export function shouldUseRootPortalView() {
  return !getActiveSpaceName()
}

export function buildSpaceScopedKey(baseKey, scope = '', projectionId = '') {
  const key = String(baseKey || '').trim()
  if (!key) {
    return ''
  }

  const activeScope = normalizeSpaceName(scope || getActiveSpaceName())
  const activeProjectionId = String(projectionId || getActiveProjectionId() || '').trim()

  let scopedKey = key
  if (activeScope) {
    scopedKey = `${scopedKey}:space:${encodeURIComponent(activeScope)}`
  }

  if (activeProjectionId) {
    scopedKey = `${scopedKey}:projection:${encodeURIComponent(activeProjectionId)}`
  }

  return scopedKey
}
