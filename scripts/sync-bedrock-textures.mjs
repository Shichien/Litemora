import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'bedrock-samples', 'resource_pack', 'textures', 'blocks')
const PUBLIC_TARGET_DIR = path.join(ROOT, 'public', 'textures', 'blocks', 'bedrock')
const GENERATED_FILE = path.join(ROOT, 'src', 'js', 'generated', 'bedrock-texture-sources.js')

const toPosix = value => value.split(path.sep).join('/')

const sanitizeName = (value) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, '_')
    .replace(/[/.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function walkPngFiles(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...await walkPngFiles(abs))
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      out.push(abs)
    }
  }
  return out
}

async function ensureExists(dir) {
  try {
    await fs.access(dir)
    return true
  }
  catch {
    return false
  }
}

async function copyToPublic(absSource) {
  const rel = path.relative(SOURCE_DIR, absSource)
  const relPosix = toPosix(rel)
  const targetAbs = path.join(PUBLIC_TARGET_DIR, rel)
  await fs.mkdir(path.dirname(targetAbs), { recursive: true })
  await fs.copyFile(absSource, targetAbs)
  return relPosix
}

function buildGeneratedModule(rows) {
  const sources = rows.map((row) => {
    return `  { name: '${row.textureName}', type: 'texture', path: '${row.publicPath}', lazy: true },`
  }).join('\n')

  const byRelative = rows.map((row) => {
    return `  '${row.relativeNoExt}': '${row.textureName}',`
  }).join('\n')

  const stemMap = new Map()
  for (const row of rows) {
    if (!stemMap.has(row.stem)) {
      stemMap.set(row.stem, row.textureName)
    }
  }

  const byStem = [...stemMap.entries()].map(([stem, name]) => {
    return `  '${stem}': '${name}',`
  }).join('\n')

  return `export const bedrockTextureSources = [\n${sources}\n]\n\nexport const bedrockTextureNameByRelative = {\n${byRelative}\n}\n\nexport const bedrockTextureNameByStem = {\n${byStem}\n}\n`
}

async function main() {
  if (!await ensureExists(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`)
  }

  const files = await walkPngFiles(SOURCE_DIR)
  files.sort((a, b) => a.localeCompare(b))

  await fs.rm(PUBLIC_TARGET_DIR, { recursive: true, force: true })
  await fs.mkdir(PUBLIC_TARGET_DIR, { recursive: true })

  const rows = []
  const usedNames = new Set()

  for (const absFile of files) {
    const relPosix = await copyToPublic(absFile)
    const relativeNoExt = relPosix.replace(/\.png$/i, '')
    const stem = path.posix.basename(relativeNoExt)

    const baseName = `bedrock_block_${sanitizeName(relativeNoExt)}`
    let textureName = baseName
    let suffix = 1
    while (usedNames.has(textureName)) {
      textureName = `${baseName}_${suffix++}`
    }
    usedNames.add(textureName)

    rows.push({
      textureName,
      publicPath: `textures/blocks/bedrock/${relPosix}`,
      relativeNoExt,
      stem,
    })
  }

  const moduleText = buildGeneratedModule(rows)
  await fs.mkdir(path.dirname(GENERATED_FILE), { recursive: true })
  await fs.writeFile(GENERATED_FILE, moduleText, 'utf8')

  console.log(`[sync-bedrock-textures] Copied PNG files: ${rows.length}`)
  console.log(`[sync-bedrock-textures] Generated source list: ${toPosix(path.relative(ROOT, GENERATED_FILE))}`)
  console.log(`[sync-bedrock-textures] Public target: ${toPosix(path.relative(ROOT, PUBLIC_TARGET_DIR))}`)
}

main().catch((error) => {
  console.error('[sync-bedrock-textures] Failed:', error)
  process.exit(1)
})
