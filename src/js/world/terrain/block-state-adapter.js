export function variantString(value) {
  if (value === undefined || value === null) {
    return ''
  }
  const raw = typeof value === 'string'
    ? value
    : (typeof value === 'object' && 'value' in value ? value.value : String(value))
  return String(raw).toLowerCase()
}

export function variantBoolean(value) {
  const normalized = variantString(value)
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}
