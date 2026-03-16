import { resolveInventoryItemKey } from './minecraft-item-catalog.js'

const DEFAULT_VISUAL = {
  textureKeys: null,
  color: 0x888888,
}

const ITEM_VISUALS = {
  grass_block: {
    textureKeys: {
      top: 'grass',
      bottom: 'dirt',
      side: 'grass_block_side_texture',
    },
    color: 0x341C0E,
  },
  dirt: {
    textureKeys: { all: 'dirt' },
    color: 0x8B5A2B,
  },
  stone: {
    textureKeys: { all: 'stone' },
    color: 0x7F7F7F,
  },
  coal_ore: {
    textureKeys: { all: 'coal_ore' },
    color: 0x2A2A2A,
  },
  iron_ore: {
    textureKeys: { all: 'iron_ore' },
    color: 0xD4A574,
  },
  oak_log: {
    textureKeys: {
      top: 'treeTrunk_TopTexture',
      bottom: 'treeTrunk_TopTexture',
      side: 'treeTrunk_SideTexture',
    },
    color: 0x6B4423,
  },
  oak_leaves: {
    textureKeys: { all: 'treeLeaves_Texture' },
    color: 0x228B22,
  },
  birch_log: {
    textureKeys: {
      top: 'birchTrunk_TopTexture',
      bottom: 'birchTrunk_TopTexture',
      side: 'birchTrunk_SideTexture',
    },
    color: 0xE8E4D9,
  },
  birch_leaves: {
    textureKeys: { all: 'birchLeaves_Texture' },
    color: 0x5D8A3E,
  },
  cherry_log: {
    textureKeys: {
      top: 'cherryTrunk_TopTexture',
      bottom: 'cherryTrunk_TopTexture',
      side: 'cherryTrunk_SideTexture',
    },
    color: 0x8B4513,
  },
  cherry_leaves: {
    textureKeys: { all: 'cherryLeaves_Texture' },
    color: 0xFFB6C1,
  },
  cactus: {
    textureKeys: {
      top: 'cactusTrunk_TopTexture',
      bottom: 'cactusTrunk_TopTexture',
      side: 'cactusTrunk_SideTexture',
    },
    color: 0x2E8B57,
  },
  sand: {
    textureKeys: { all: 'sand' },
    color: 0xC2B280,
  },
  red_sand: {
    textureKeys: { all: 'red_sand' },
    color: 0xCD853F,
  },
  yellow_terracotta: {
    textureKeys: { all: 'terracotta_yellow' },
    color: 0xD2691E,
  },
  ice: {
    textureKeys: { all: 'ice_Texture' },
    color: 0xADD8E6,
  },
  packed_ice: {
    textureKeys: { all: 'packedIce_Texture' },
    color: 0x87CEEB,
  },
  snow_block: {
    textureKeys: { all: 'snow' },
    color: 0xFFFAFA,
  },
  gravel: {
    textureKeys: { all: 'gravel_Texture' },
    color: 0x808080,
  },
  diorite: {
    textureKeys: { all: 'diorite_Texture' },
    color: 0xD8D8D8,
  },
  polished_diorite: {
    textureKeys: { all: 'polishedDiorite_Texture' },
    color: 0xECECEC,
  },
  andesite: {
    textureKeys: { all: 'andesite_Texture' },
    color: 0x8F8F94,
  },
  polished_andesite: {
    textureKeys: { all: 'polishedAndesite_Texture' },
    color: 0xA3A3A8,
  },
  polished_blackstone: {
    textureKeys: { all: 'polishedBlackstone_Texture' },
    color: 0x3B3B44,
  },
  polished_blackstone_bricks: {
    textureKeys: { all: 'polishedBlackstoneBricks_Texture' },
    color: 0x464650,
  },
  cracked_polished_blackstone_bricks: {
    textureKeys: { all: 'crackedPolishedBlackstoneBricks_Texture' },
    color: 0x373740,
  },
  ochre_froglight: {
    textureKeys: {
      top: 'ochreFroglight_TopTexture',
      bottom: 'ochreFroglight_TopTexture',
      side: 'ochreFroglight_SideTexture',
    },
    color: 0xD7B465,
  },
  pearlescent_froglight: {
    textureKeys: {
      top: 'pearlescentFroglight_TopTexture',
      bottom: 'pearlescentFroglight_TopTexture',
      side: 'pearlescentFroglight_SideTexture',
    },
    color: 0xCFBF92,
  },
  stone_slab: {
    textureKeys: { all: 'stone' },
    color: 0x7F7F7F,
  },
  stone_stairs: {
    textureKeys: { all: 'stone' },
    color: 0x7F7F7F,
  },
}

function hashStringToColor(text = '') {
  let hash = 0
  const source = String(text || '')
  for (let index = 0; index < source.length; index++) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index)
    hash |= 0
  }

  const normalized = Math.abs(hash)
  const r = 96 + (normalized % 96)
  const g = 96 + (Math.floor(normalized / 97) % 96)
  const b = 96 + (Math.floor(normalized / 9409) % 96)
  return (r << 16) | (g << 8) | b
}

export function getMinecraftItemVisualDescriptor(input = null) {
  const itemKey = resolveInventoryItemKey(input)
  if (!itemKey) {
    const blockId = Number(input?.blockId ?? input)
    if (!Number.isFinite(blockId) || blockId <= 0) {
      return DEFAULT_VISUAL
    }

    return {
      textureKeys: null,
      color: hashStringToColor(`legacy:${Math.trunc(blockId)}`),
    }
  }

  const mapped = ITEM_VISUALS[itemKey]
  if (mapped) {
    return mapped
  }

  return {
    textureKeys: null,
    color: hashStringToColor(itemKey),
  }
}
