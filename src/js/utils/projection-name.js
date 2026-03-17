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

export function createUniqueProjectionSlug(value = '', existingItems = []) {
  const baseSlug = normalizeProjectionSlug(value) || 'world'
  const usedSlugs = new Set(
    (Array.isArray(existingItems) ? existingItems : [])
      .map(item => normalizeProjectionSlug(item?.projectionSlug || item?.slug || ''))
      .filter(Boolean),
  )

  if (!usedSlugs.has(baseSlug)) {
    return baseSlug
  }

  let suffix = 2
  while (usedSlugs.has(`${baseSlug}${suffix}`)) {
    suffix += 1
  }

  return `${baseSlug}${suffix}`
}
