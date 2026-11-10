import fs from 'node:fs/promises'
import { createRequire } from 'node:module'

// Updates only the generated metadata line. Explicit per-state overrides remain intact.
const require = createRequire(import.meta.url)
const blocks = require('minecraft-data/minecraft-data/data/pc/1.21.11/blocks.json')

const table = {}
for (const block of blocks) {
  let stateIndex = block.defaultState - block.minStateId
  const defaults = {}
  for (const property of [...block.states].reverse()) {
    const index = stateIndex % property.num_values
    stateIndex = Math.floor(stateIndex / property.num_values)
    defaults[property.name] = property.type === 'bool'
      ? (index === 0 ? 'true' : 'false')
      : String(property.values?.[index] ?? index)
  }
  table[block.name] = [block.filterLight, block.emitLight, block.filterLight === 15 && !block.transparent ? 1 : 0, defaults]
}
const target = new URL('../src/js/world/terrain/minecraft-light-properties.js', import.meta.url)
const source = await fs.readFile(target, 'utf8')
if (!/^const BLOCKS = .*$/m.test(source))
  throw new Error('Generated light metadata marker missing')
await fs.writeFile(target, source.replace(/^const BLOCKS = .*$/m, `const BLOCKS = ${JSON.stringify(table)}`))
console.log(`Updated Java 1.21.11 light metadata for ${blocks.length} blocks; run ESLint on the generated file.`)
