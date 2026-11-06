/**
 * Share a spot inside a world: the pause menu copies a link that carries the
 * player's position, and the world boots the player there.
 */

const POSITION_PARAM = 'at'

function round(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0
}

export function formatSharedPosition(position = {}) {
  return `${round(position.x)},${round(position.y)},${round(position.z)}`
}

export function buildPositionShareUrl(position = {}, baseUrl = window.location.href) {
  const url = new URL(baseUrl)
  url.searchParams.set(POSITION_PARAM, formatSharedPosition(position))
  // The hash carries view state (#admin-config etc); a shared spot never needs it.
  url.hash = ''
  return url.toString()
}

/**
 * Read a shared spot out of the query string.
 * @param {string} search - Query string to parse, defaults to the current URL's.
 * @returns {{x: number, y: number, z: number} | null} The spot, or null when absent/invalid.
 */
export function readSharedPosition(search = window.location.search) {
  const raw = new URLSearchParams(search).get(POSITION_PARAM)
  if (!raw) {
    return null
  }

  const parts = String(raw).split(',').map((part) => Number(part.trim()))
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
    return null
  }

  return { x: parts[0], y: parts[1], z: parts[2] }
}
