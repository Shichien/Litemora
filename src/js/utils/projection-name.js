const PROJECTION_NAME_MAX_LENGTH = 48

function toSafeString(value = '') {
  return String(value || '').trim()
}

export function sanitizeProjectionNameInput(value = '') {
  return toSafeString(value)
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, PROJECTION_NAME_MAX_LENGTH)
}

export function normalizeProjectionSlug(value = '') {
  return sanitizeProjectionNameInput(value).toLowerCase()
}

export function isValidProjectionName(value = '') {
  return /^[a-z0-9]{1,48}$/iu.test(sanitizeProjectionNameInput(value))
}

export function ensureProjectionDisplayName(value = '', fallback = 'World') {
  return sanitizeProjectionNameInput(value) || sanitizeProjectionNameInput(fallback) || 'World'
}
