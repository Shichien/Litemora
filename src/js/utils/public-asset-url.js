function getBaseUrl() {
  const rawBaseUrl = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
    ? String(import.meta.env.BASE_URL)
    : '/'

  if (!rawBaseUrl || rawBaseUrl === './') {
    return '/'
  }

  return rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`
}

function isAbsoluteAssetUrl(value) {
  return /^(?:[a-z]+:)?\/\//iu.test(value)
    || value.startsWith('data:')
    || value.startsWith('blob:')
}

export function resolvePublicAssetUrl(path) {
  if (typeof path !== 'string') {
    return path
  }

  const trimmedPath = path.trim()
  if (!trimmedPath || isAbsoluteAssetUrl(trimmedPath)) {
    return trimmedPath
  }

  const baseUrl = getBaseUrl()
  const normalizedPath = trimmedPath.replace(/^\/+/u, '')

  return `${baseUrl}${normalizedPath}`
}

export function resolvePublicAssetPath(input) {
  if (Array.isArray(input)) {
    return input.map(resolvePublicAssetPath)
  }

  return resolvePublicAssetUrl(input)
}
