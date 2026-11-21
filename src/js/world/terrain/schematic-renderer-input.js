import { isAxiomBlueprint } from './schematic-extra-formats.js'
import { encodeRendererPalette } from './schematic-renderer-encode.js'

// Nucleation expects the older field names. Replace only the palette payloads
// in the renderer's copy, preserving inventory, entities and pending ticks.
function adaptLitematicPalettes(raw, parsed, regions) {
  const chunks = []
  let offset = 0
  for (const [name, region] of Object.entries(regions)) {
    const entries = region.BlockStatePalette
    if (!entries?.some(entry => typeof entry === 'string' || entry.id !== undefined))
      continue
    const [start, end] = parsed.value.Regions.value[name].value.BlockStatePalette.range
    chunks.push({ start, end, data: encodeRendererPalette(entries) })
  }
  if (!chunks.length)
    return raw
  const result = new Uint8Array(chunks.reduce((size, { start, end, data }) => size + data.length - (end - start), raw.length))
  let written = 0
  for (const { start, end, data } of chunks.sort((a, b) => a.start - b.start)) {
    result.set(raw.subarray(offset, start), written)
    written += start - offset
    result.set(data, written)
    written += data.length
    offset = end
  }
  result.set(raw.subarray(offset), written)
  return result
}

/** Adapt formats unsupported by nucleation, preserving the original upload. */
export async function prepareSchematicRendererBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength)
    return buffer
  const pakoModule = await import('pako')
  const pako = pakoModule.default || pakoModule
  let raw = new Uint8Array(buffer)
  let needsConversion = isAxiomBlueprint(buffer)
  if (!needsConversion) {
    if (raw[0] !== 0x0A)
      raw = pako.inflate(raw)
    const { parseNbt, simplifyNbt } = await import('./nbt-browser.js')
    const { parsed } = await parseNbt(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), { trackTag: 'BlockStatePalette' })
    const parsedRoot = simplifyNbt(parsed)
    const root = parsedRoot.Schematic || parsedRoot
    if (parsedRoot.Regions)
      raw = adaptLitematicPalettes(raw, parsed, parsedRoot.Regions)
    needsConversion = Boolean((root.Blocks && root.Data && !root.Palette) || (root.Palette && root.Version === 1))
  }
  if (needsConversion) {
    const { default: service } = await import('./schematic-service.js')
    const { encodeRendererLitematic } = await import('./schematic-renderer-encode.js')
    const schematic = await service.parseArrayBuffer(buffer, { remember: false })
    // Sponge's origin is applied by the runtime bridge; the renderer uses zero.
    if (schematic.format === 'schem') {
      for (const region of Object.values(schematic.regions))
        region.position = { x: 0, y: 0, z: 0 }
    }
    raw = encodeRendererLitematic(schematic)
  }
  const compressed = pako.gzip(raw)
  return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)
}
