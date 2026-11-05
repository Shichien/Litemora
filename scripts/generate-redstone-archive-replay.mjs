import { Buffer as BufferPolyfill } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { gzipSync } from 'node:zlib'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

const REPLAY_FORMAT = 'litemora-redstone-replay-v1'
const INITIAL_SETTLE_TAIL_TICKS = 20
const MAX_SETTLE_TAIL_TICKS = 4096

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

function runCommand(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve({
          stdout: BufferPolyfill.concat(stdout).toString('utf8'),
          stderr: BufferPolyfill.concat(stderr).toString('utf8'),
        })
        return
      }
      reject(new Error([
        `${path.basename(executable)} failed with ${signal || `exit code ${code}`}`,
        BufferPolyfill.concat(stderr).toString('utf8').trim(),
      ].filter(Boolean).join('\n')))
    })
  })
}

function normalizeProperties(properties) {
  if (!properties || typeof properties !== 'object') {
    return {}
  }
  return Object.fromEntries(
    Object.entries(properties)
      .map(([name, value]) => [String(name), String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function serializeBlockState(name, properties = {}) {
  const entries = Object.entries(normalizeProperties(properties))
  if (!entries.length) {
    return name
  }
  return `${name}[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]`
}

function buildStateRegistry(blocksReport) {
  const registry = new Map([[0, 'minecraft:air']])
  for (const [blockName, block] of Object.entries(blocksReport || {})) {
    for (const state of block?.states || []) {
      if (!Number.isInteger(state?.id) || state.id < 0) {
        continue
      }
      registry.set(state.id, serializeBlockState(blockName, state.properties))
    }
  }
  return registry
}

function blockKey(position) {
  return `${position.x},${position.y},${position.z}`
}

function isMovingPistonState(blockString) {
  return String(blockString || '').startsWith('minecraft:moving_piston')
}

async function* readJsonLines(filePath) {
  const input = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0

  try {
    for await (const rawLine of lines) {
      lineNumber += 1
      const line = rawLine.trim()
      if (!line) {
        continue
      }
      try {
        yield JSON.parse(line)
      }
      catch (error) {
        throw new Error(`Invalid trace JSON at line ${lineNumber}: ${error.message}`)
      }
    }
  }
  finally {
    input.destroy()
  }
}

function createPalette() {
  const entries = ['minecraft:air']
  const lookup = new Map([[entries[0], 0]])
  return {
    entries,
    indexOf(blockString) {
      const normalized = String(blockString || 'minecraft:air').trim() || 'minecraft:air'
      let index = lookup.get(normalized)
      if (index !== undefined) {
        return index
      }
      index = entries.length
      entries.push(normalized)
      lookup.set(normalized, index)
      return index
    },
  }
}

function resolveState(registry, stateId) {
  const blockString = registry.get(Number(stateId))
  if (!blockString) {
    throw new Error(`Official registry does not contain block state id ${stateId}`)
  }
  return blockString
}

async function compactTrace({
  traceEvents,
  inspectReport,
  minimumTotalTicks,
  registry,
  metadata,
}) {
  const palette = createPalette()
  const initialByPosition = new Map()
  const currentBlockStrings = new Map()
  const movingPistonPositions = new Set()
  for (const block of inspectReport.blocks || []) {
    const position = block?.position
    if (!position || !block?.state) {
      continue
    }
    const key = blockKey(position)
    const blockString = serializeBlockState(block.state.name, block.state.properties)
    initialByPosition.set(blockKey(position), {
      x: Number(position.x),
      y: Number(position.y),
      z: Number(position.z),
      state: palette.indexOf(blockString),
    })
    currentBlockStrings.set(key, blockString)
    if (isMovingPistonState(blockString)) {
      movingPistonPositions.add(key)
    }
  }

  const ticks = new Map()
  const touched = new Map()
  let activeTick = null
  let boundaryCaptured = false
  let boundaryPendingPositions = new Set()
  let settledEndTick = null
  let changeCount = 0

  for await (const event of traceEvents) {
    const tick = Math.max(0, Math.floor(Number(event?.tick || 0)))
    if (activeTick !== null && tick !== activeTick) {
      if (boundaryCaptured && boundaryPendingPositions.size === 0) {
        settledEndTick = Math.max(minimumTotalTicks, activeTick)
        break
      }
    }
    if (!boundaryCaptured && tick > minimumTotalTicks) {
      boundaryCaptured = true
      boundaryPendingPositions = new Set(movingPistonPositions)
      if (boundaryPendingPositions.size === 0) {
        settledEndTick = minimumTotalTicks
        break
      }
    }
    activeTick = tick

    if (event.event === 'block_changed' && event.pos) {
      const position = {
        x: Number(event.pos.x),
        y: Number(event.pos.y),
        z: Number(event.pos.z),
      }
      const key = blockKey(position)
      const previousBlockString = currentBlockStrings.get(key)
        || resolveState(registry, event.old_state)
      const nextBlockString = resolveState(registry, event.new_state)
      if (isMovingPistonState(previousBlockString)) {
        movingPistonPositions.delete(key)
      }
      if (isMovingPistonState(nextBlockString)) {
        movingPistonPositions.add(key)
      }
      currentBlockStrings.set(key, nextBlockString)
      const completesBoundaryMotion = boundaryCaptured
        && boundaryPendingPositions.has(key)
        && !isMovingPistonState(nextBlockString)
      const shouldRecordChange = tick <= minimumTotalTicks
        || (boundaryCaptured && boundaryPendingPositions.has(key))

      if (tick === 0) {
        const initialState = {
          ...position,
          state: palette.indexOf(nextBlockString),
        }
        initialByPosition.set(key, initialState)
        touched.set(key, initialState)
        continue
      }

      if (!shouldRecordChange) {
        continue
      }

      if (!ticks.has(tick)) {
        ticks.set(tick, { tick, changes: [], actions: [] })
      }
      const frame = ticks.get(tick)
      if (!touched.has(key)) {
        touched.set(key, initialByPosition.get(key) || {
          ...position,
          state: palette.indexOf(resolveState(registry, event.old_state)),
        })
      }
      frame.changes.push({
        ...position,
        state: palette.indexOf(nextBlockString),
        previousState: palette.indexOf(previousBlockString),
        microStep: Math.max(0, Math.floor(Number(event.micro_step || 0))),
        cause: String(event.cause || ''),
      })
      changeCount += 1

      if (completesBoundaryMotion) {
        boundaryPendingPositions.delete(key)
      }
    }
    else if (event.event === 'action' && tick <= minimumTotalTicks) {
      if (!ticks.has(tick)) {
        ticks.set(tick, { tick, changes: [], actions: [] })
      }
      const frame = ticks.get(tick)
      frame.actions.push({
        microStep: Math.max(0, Math.floor(Number(event.micro_step || 0))),
        action: event.action || null,
      })
    }
  }

  if (!boundaryCaptured) {
    boundaryCaptured = true
    boundaryPendingPositions = new Set(movingPistonPositions)
  }
  if (settledEndTick === null && boundaryPendingPositions.size === 0) {
    settledEndTick = Math.max(minimumTotalTicks, activeTick || 0)
  }

  if (settledEndTick === null) {
    return {
      replay: null,
      unsettledMovingPistons: [...boundaryPendingPositions],
    }
  }

  const frames = [...ticks.values()]
    .filter(frame => frame.tick <= settledEndTick)
    .filter(frame => frame.changes.length || frame.actions.length)
    .sort((left, right) => left.tick - right.tick)

  for (const frame of frames) {
    frame.changes.sort((left, right) => left.microStep - right.microStep)
    frame.actions.sort((left, right) => left.microStep - right.microStep)
  }

  return {
    replay: {
      format: REPLAY_FORMAT,
      minecraftVersion: metadata.minecraftVersion,
      dataVersion: inspectReport.data_version ?? null,
      engine: metadata.engine,
      title: metadata.title,
      description: metadata.description,
      ticksPerSecond: 20,
      totalTicks: settledEndTick,
      durationSeconds: settledEndTick / 20,
      changeCount,
      bounds: inspectReport.bounds || null,
      palette: palette.entries,
      baseline: [...touched.values()],
      frames,
    },
    unsettledMovingPistons: [],
  }
}

async function main() {
  const redstoneExecutable = path.resolve(requireArg('--redstone'))
  const scenarioPath = path.resolve(requireArg('--scenario'))
  const structurePath = path.resolve(requireArg('--structure'))
  const registryPath = path.resolve(requireArg('--registry'))
  const outputPath = path.resolve(requireArg('--output'))
  const engine = readArg('--engine', 'interpreted')
  const minecraftVersion = readArg('--minecraft-version', '26.1.2')
  const title = readArg('--title', path.basename(structurePath, path.extname(structurePath)))
  const description = readArg('--description', '')
  const workingDirectory = path.dirname(scenarioPath)
  const scenario = parseToml(await fs.readFile(scenarioPath, 'utf8'))
  const minimumTotalTicks = Math.floor(Number(scenario.max_ticks))
  if (!Number.isSafeInteger(minimumTotalTicks) || minimumTotalTicks <= 0) {
    throw new RangeError('Scenario max_ticks must be a positive safe integer')
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'litemora-redstone-replay-'))
  const tracePath = path.join(tempRoot, 'trace.jsonl')
  const tempScenarioPath = path.join(
    workingDirectory,
    `.litemora-${path.basename(tempRoot)}-${path.basename(scenarioPath)}`,
  )

  try {
    const inspectResult = await runCommand(
      redstoneExecutable,
      ['inspect', structurePath, '--all', '--json'],
      workingDirectory,
    )
    const inspectReport = JSON.parse(inspectResult.stdout)
    const registry = buildStateRegistry(JSON.parse(await fs.readFile(registryPath, 'utf8')))
    let settleTailTicks = INITIAL_SETTLE_TAIL_TICKS
    let replay = null
    let unsettledMovingPistons = []

    while (!replay && settleTailTicks <= MAX_SETTLE_TAIL_TICKS) {
      const extendedScenario = structuredClone(scenario)
      extendedScenario.max_ticks = minimumTotalTicks + settleTailTicks
      await fs.writeFile(tempScenarioPath, stringifyToml(extendedScenario), 'utf8')
      await runCommand(redstoneExecutable, [
        'trace',
        tempScenarioPath,
        '--engine',
        engine,
        '--output',
        tracePath,
      ], workingDirectory)

      const compacted = await compactTrace({
        traceEvents: readJsonLines(tracePath),
        inspectReport,
        minimumTotalTicks,
        registry,
        metadata: {
          minecraftVersion,
          engine,
          title,
          description,
        },
      })
      replay = compacted.replay
      unsettledMovingPistons = compacted.unsettledMovingPistons
      settleTailTicks *= 2
    }

    if (!replay) {
      throw new Error([
        `Replay did not reach a complete piston boundary within ${MAX_SETTLE_TAIL_TICKS} tail ticks`,
        `Unsettled moving pistons: ${unsettledMovingPistons.slice(0, 8).join(' ')}${unsettledMovingPistons.length > 8 ? ' ...' : ''}`,
      ].join('\n'))
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const serializedReplay = `${JSON.stringify(replay)}\n`
    // Cloudflare Pages rejects assets over 25 MiB, so long replays are stored gzip-compressed.
    await fs.writeFile(
      outputPath,
      outputPath.endsWith('.gz') ? gzipSync(serializedReplay, { level: 9 }) : serializedReplay,
    )

    console.log(`Generated replay: ${outputPath}`)
    console.log(`Ticks: ${replay.totalTicks}`)
    console.log(`State changes: ${replay.changeCount}`)
    console.log(`Touched blocks: ${replay.baseline.length}`)
    console.log(`Palette entries: ${replay.palette.length}`)
  }
  finally {
    await fs.rm(tempScenarioPath, { force: true })
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
