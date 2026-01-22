/**
 * 皮肤系统配置文件
 * 定义可用皮肤列表、默认皮肤以及动画控制按钮配置
 */

// 可用皮肤列表
export const SKIN_LIST = [
  {
    id: 'steve',
    name: 'Steve',
    nameKey: 'skin.steve', // i18n key
    modelPath: 'models/character/steve.glb',
    thumbnail: 'textures/skins/steve-thumb.png',
    // 来源: https://www.planetminecraft.com/member/hibiki_ekko/
  },
  {
    id: 'alex',
    name: 'Alex',
    nameKey: 'skin.alex',
    modelPath: 'models/character/alex.glb',
    thumbnail: 'textures/skins/alex-thumb.png',
    // 来源: https://www.planetminecraft.com/member/hibiki_ekko/
  },
  {
    id: 'player',
    name: 'Classic',
    nameKey: 'skin.player',
    modelPath: 'models/character/player.glb',
    thumbnail: 'textures/skins/player-thumb.png',
    // 来源: https://www.minecraftskins.com/profile/5521971/holland0519
  },
]

// 默认皮肤 ID
export const DEFAULT_SKIN_ID = 'steve'

// 动画控制按钮配置（皮肤选择界面左侧按钮组）
export const ANIMATION_BUTTONS = [
  { id: 'idle', icon: '🧍', labelKey: 'anim.idle', clip: 'idle' },
  { id: 'walk', icon: '🚶', labelKey: 'anim.walk', clip: 'forward' },
  { id: 'run', icon: '🏃', labelKey: 'anim.run', clip: 'running_forward' },
  { id: 'tpose', icon: '✋', labelKey: 'anim.tpose', clip: 'tpose' },
  { id: 'mine', icon: '⛏️', labelKey: 'anim.mine', clip: 'quick_combo_punch' },
  { id: 'jump', icon: '🦘', labelKey: 'anim.jump', clip: 'jump' },
  { id: 'attack', icon: '⚔️', labelKey: 'anim.attack', clip: 'straight_punch' },
  { id: 'block', icon: '🛡️', labelKey: 'anim.block', clip: 'block' },
]
