import { Buffer as BufferPolyfill } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : String(process.argv[index + 1] || '').trim()
}

function requireArg(name) {
  const value = readArg(name)
  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

async function readJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`)
  }
  return response.json()
}

async function fileSha1(filePath) {
  const bytes = await fs.readFile(filePath)
  return createHash('sha1').update(bytes).digest('hex')
}

async function downloadArtifact(artifact, destination) {
  if (!artifact?.url || !artifact?.sha1) {
    throw new Error(`Artifact metadata is incomplete for ${destination}`)
  }

  try {
    const currentHash = await fileSha1(destination)
    if (currentHash === artifact.sha1) {
      return
    }
  }
  catch {
    // The destination does not exist yet.
  }

  const response = await fetch(artifact.url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${artifact.url}`)
  }

  const bytes = BufferPolyfill.from(await response.arrayBuffer())
  const actualHash = createHash('sha1').update(bytes).digest('hex')
  if (actualHash !== artifact.sha1) {
    throw new Error(`SHA-1 mismatch for ${artifact.url}`)
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, bytes)
}

async function runPool(items, concurrency, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function runJava(javaExecutable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExecutable, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Java data generator failed with ${signal || `exit code ${code}`}`))
    })
  })
}

async function main() {
  const version = requireArg('--version')
  const outputRoot = path.resolve(readArg('--output', path.join('output', 'redstone-registry', version)))
  const cacheRoot = path.resolve(readArg('--cache', path.join(os.tmpdir(), 'litemora-minecraft-data', version)))
  const javaExecutable = readArg('--java', 'java')

  const manifest = await readJson(VERSION_MANIFEST_URL)
  const versionEntry = manifest.versions?.find(entry => entry.id === version)
  if (!versionEntry?.url) {
    throw new Error(`Minecraft version is not present in the official manifest: ${version}`)
  }

  const versionMetadata = await readJson(versionEntry.url)
  const clientArtifact = versionMetadata?.downloads?.client
  const clientJar = path.join(cacheRoot, `client-${version}.jar`)
  await downloadArtifact(clientArtifact, clientJar)

  const libraryArtifacts = (versionMetadata.libraries || [])
    .map(entry => entry?.downloads?.artifact)
    .filter(artifact => artifact?.path && artifact?.url && artifact?.sha1)

  await runPool(libraryArtifacts, 8, async (artifact, index) => {
    await downloadArtifact(artifact, path.join(cacheRoot, 'libraries', artifact.path))
    if ((index + 1) % 20 === 0 || index + 1 === libraryArtifacts.length) {
      console.log(`Minecraft runtime libraries: ${index + 1}/${libraryArtifacts.length}`)
    }
  })

  const classpath = [
    clientJar,
    ...libraryArtifacts.map(artifact => path.join(cacheRoot, 'libraries', artifact.path)),
  ].join(path.delimiter)

  await fs.mkdir(outputRoot, { recursive: true })
  await runJava(javaExecutable, [
    '-Xmx4g',
    '-cp',
    classpath,
    'net.minecraft.data.Main',
    '--reports',
    '--output',
    outputRoot,
  ], process.cwd())

  const blocksReport = path.join(outputRoot, 'reports', 'blocks.json')
  const report = JSON.parse(await fs.readFile(blocksReport, 'utf8'))
  const stateCount = Object.values(report).reduce(
    (total, block) => total + (Array.isArray(block?.states) ? block.states.length : 0),
    0,
  )
  if (!stateCount) {
    throw new Error(`Official blocks report contains no states: ${blocksReport}`)
  }

  console.log(`Generated registry: ${blocksReport}`)
  console.log(`Minecraft version: ${version}`)
  console.log(`Block states: ${stateCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
