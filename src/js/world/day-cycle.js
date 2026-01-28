import { useHudStore } from '@pinia/hudStore.js'
import * as THREE from 'three'

import Experience from '../experience.js'
import SkyDome from './sky-dome.js'

/**
 * DayCycle - 昼夜循环系统
 * 管理太阳/月亮轨迹、天空盒切换、雾气变化
 */
export default class DayCycle {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources
    this.debug = this.experience.debug.ui
    this.debugActive = this.experience.debug.active

    // HUD Store 用于更新时间显示
    this.hud = useHudStore()

    // 参数配置
    this.params = {
      // 时间控制
      timeOfDay: 0.25, // 0-1, 默认早晨 6:00
      autoPlay: true, // 自动循环
      dayDuration: 20 * 60 * 1000, // 20分钟 = 游戏一天（毫秒）

      // 太阳轨迹
      sunOrbitRadius: 100, // 太阳轨道半径
      sunOrbitHeight: 80, // 最高点高度

      // 月光
      moonIntensity: 1.2, // 月光强度（提高可见度）
      moonColor: '#e4edff', // 冷色调

      // 时间流逝速率
      timeSpeed: 1.0, // 调试用倍速
    }

    // // 时段配置（与贴图对应，共 7 个时段）
    // this.phaseConfig = {
    //   sunrise: {
    //     texture: 'sky_sunriseTexture',
    //     sunIntensity: 0.8,
    //     sunColor: '#ffcc88',
    //     ambientIntensity: 0.5,
    //     ambientColor: '#ffd4a3',
    //     fog: { color: '#af7a4c', density: 0.015 },
    //   },
    //   morning: {
    //     texture: 'sky_morningTexture',
    //     sunIntensity: 1.2,
    //     sunColor: '#fff0d0',
    //     ambientIntensity: 0.65,
    //     ambientColor: '#fffaf0',
    //     fog: { color: '#91c7ed', density: 0.010 },
    //   },
    //   noon: {
    //     texture: 'sky_noonTexture',
    //     sunIntensity: 1.75,
    //     sunColor: '#ffffff',
    //     ambientIntensity: 0.75,
    //     ambientColor: '#ffffff',
    //     fog: { color: '#989490', density: 0.006 },
    //   },
    //   afternoon: {
    //     texture: 'sky_afternoonTexture',
    //     sunIntensity: 1.4,
    //     sunColor: '#fff5e0',
    //     ambientIntensity: 0.7,
    //     ambientColor: '#9a754b',
    //     fog: { color: '#97703b', density: 0.008 },
    //   },
    //   sunset: {
    //     texture: 'sky_sunsetTexture',
    //     sunIntensity: 0.9,
    //     sunColor: '#ff9966',
    //     ambientIntensity: 0.4,
    //     ambientColor: '#ffaa77',
    //     fog: { color: '#e8a87c', density: 0.012 },
    //   },
    //   dusk: {
    //     texture: 'sky_duskTexture',
    //     sunIntensity: 0.4,
    //     sunColor: '#9988aa',
    //     ambientIntensity: 0.4,
    //     ambientColor: '#7788aa',
    //     fog: { color: '#5c6080', density: 0.015 },
    //   },
    //   midnight: {
    //     texture: 'sky_midnightTexture',
    //     sunIntensity: 0.1,
    //     sunColor: '#334455',
    //     ambientIntensity: 0.35,
    //     ambientColor: '#445566',
    //     fog: { color: '#1a1a2e', density: 0.018 },
    //   },
    // }
    // 时段配置（与贴图对应，共 7 个时段）
    // Director-grade, skybox-calibrated preset
    this.phaseConfig = {
      sunrise: {
        texture: 'sky_sunriseTexture',
        sunIntensity: 0.65,
        sunColor: '#ffb98a',
        ambientIntensity: 0.45,
        ambientColor: '#ffd1aa',
        fog: {
          color: '#8f7663', // 粉橙暖色，匹配日出地平线
          density: 0.0015,
        },
      },

      morning: {
        texture: 'sky_morningTexture',
        sunIntensity: 1.05,
        sunColor: '#fff1d6',
        ambientIntensity: 0.65,
        ambientColor: '#fff7ee',
        fog: {
          color: '#b8daf5', // 清澈淡蓝，匹配晨光天空
          density: 0.010,
        },
      },

      noon: {
        texture: 'sky_noonTexture',
        sunIntensity: 1.55,
        sunColor: '#ffffff',
        ambientIntensity: 0.75,
        ambientColor: '#ffffff',
        fog: {
          color: '#8ecfff', // 明亮饱和蓝，匹配正午蓝天
          density: 0.005,
        },
      },

      afternoon: {
        texture: 'sky_afternoonTexture',
        sunIntensity: 1.35,
        sunColor: '#fff4e0',
        ambientIntensity: 0.7,
        ambientColor: '#fff6ec',
        fog: {
          color: '#909172', // 浅蓝偏暖，匹配下午天空
          density: 0.010,
        },
      },

      sunset: {
        texture: 'sky_sunsetTexture',
        sunIntensity: 0.85,
        sunColor: '#ff9a63',
        ambientIntensity: 0.45,
        ambientColor: '#ffb27a',
        fog: {
          color: '#7f5201', // 橙红色，匹配日落火烧云
          density: 0.013,
        },
      },

      dusk: {
        texture: 'sky_duskTexture',
        sunIntensity: 0.35,
        sunColor: '#9b8bb0',
        ambientIntensity: 0.4,
        ambientColor: '#6f7fa8',
        fog: {
          color: '#58362d', // 紫蓝色，匹配暮光效果
          density: 0.015,
        },
      },

      midnight: {
        texture: 'sky_midnightTexture',
        sunIntensity: 0.12,
        sunColor: '#334466',
        ambientIntensity: 0.75,
        ambientColor: '#455a78',
        fog: {
          color: '#141820', // 深蓝黑，匹配星空夜色
          density: 0.024,
        },
      },
    }

    /**
     * 时段定义（基于 timeOfDay 0-1，共 7 个时段）
     *
     * 时间段范围（timeOfDay 0-1）：
     * 1. midnight（午夜）: 0.00 - 0.22 和 0.85 - 1.00
     * 2. sunrise（日出）: 0.22 - 0.28
     * 3. morning（早晨）: 0.28 - 0.40
     * 4. noon（正午）: 0.40 - 0.55
     * 5. afternoon（下午）: 0.55 - 0.70
     * 6. sunset（日落）: 0.70 - 0.78
     * 7. dusk（黄昏）: 0.78 - 0.85
     *
     * 转换为24小时制：
     * - midnight: 00:00 - 05:15 和 20:20 - 24:00
     * - sunrise: 05:15 - 06:40
     * - morning: 06:40 - 09:40
     * - noon: 09:40 - 13:15
     * - afternoon: 13:15 - 16:45
     * - sunset: 16:45 - 18:45
     * - dusk: 18:45 - 20:20
     */
    // 时段时间范围（用于插值，共 7 个时段 + 午夜循环）
    this.phaseRanges = [
      { name: 'midnight', start: 0.00, end: 0.22 },
      { name: 'sunrise', start: 0.22, end: 0.28 },
      { name: 'morning', start: 0.28, end: 0.40 },
      { name: 'noon', start: 0.40, end: 0.55 },
      { name: 'afternoon', start: 0.55, end: 0.70 },
      { name: 'sunset', start: 0.70, end: 0.78 },
      { name: 'dusk', start: 0.78, end: 0.85 },
      { name: 'midnight', start: 0.85, end: 1.00 },
    ]

    // 内部状态
    this._lastTime = performance.now()
    this._currentPhase = 'noon'
    this._previousDayCount = 0

    // 加载天空盒贴图
    this._loadSkyTextures()

    // 创建天空球（替代 scene.background）
    this.skyDome = new SkyDome()

    // 初始化天空球贴图
    this._initSkyDome()

    // 创建月光光源
    this._createMoonLight()

    // 初始化调试面板
    if (this.debugActive) {
      this.debugInit()
    }
  }

  /**
   * 加载并配置天空盒贴图
   */
  _loadSkyTextures() {
    this.skyTextures = {}
    const phases = ['sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk', 'midnight']

    for (const phase of phases) {
      const textureName = this.phaseConfig[phase].texture
      const texture = this.resources.items[textureName]
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.mapping = THREE.EquirectangularReflectionMapping
        this.skyTextures[phase] = texture
      }
      else {
        console.warn(`[DayCycle] 未找到天空盒贴图: ${textureName}`)
      }
    }
  }

  /**
   * 初始化天空球贴图
   */
  _initSkyDome() {
    const { phase, nextPhase } = this._getPhaseInfo()
    const currentTex = this.skyTextures[phase]
    const nextTex = this.skyTextures[nextPhase]

    if (currentTex && nextTex) {
      this.skyDome.setTextures(currentTex, nextTex)
      this.skyDome.setMixFactor(0)
    }
  }

  /**
   * 创建月光光源
   */
  _createMoonLight() {
    this.moonLight = new THREE.DirectionalLight(
      this.params.moonColor,
      0, // 初始强度为 0，白天不显示
    )
    this.moonLight.position.set(-50, 40, -50)
    this.scene.add(this.moonLight)
  }

  /**
   * 获取当前时段和进度
   * @returns {{ phase: string, progress: number, nextPhase: string }} 时段信息对象
   */
  _getPhaseInfo() {
    const t = this.params.timeOfDay

    for (let i = 0; i < this.phaseRanges.length; i++) {
      const range = this.phaseRanges[i]
      if (t >= range.start && t < range.end) {
        const progress = (t - range.start) / (range.end - range.start)
        const nextIndex = (i + 1) % this.phaseRanges.length
        const nextPhase = this.phaseRanges[nextIndex].name
        return { phase: range.name, progress, nextPhase }
      }
    }

    return { phase: 'midnight', progress: 0, nextPhase: 'sunrise' }
  }

  /**
   * 线性插值两个颜色
   */
  _lerpColor(colorA, colorB, t) {
    const a = new THREE.Color(colorA)
    const b = new THREE.Color(colorB)
    return a.lerp(b, t)
  }

  /**
   * 线性插值数值
   */
  _lerp(a, b, t) {
    return a + (b - a) * t
  }

  /**
   * 更新太阳位置（弧形轨迹）
   */
  _updateSunPosition(environment) {
    if (!environment || !environment.sunLight)
      return

    // 太阳轨迹：从东边升起 (0.22-0.50) 到西边落下 (0.50-0.78)
    // timeOfDay 0.22 = 日出, 0.50 = 正午, 0.78 = 日落后

    const t = this.params.timeOfDay
    const { sunOrbitRadius, sunOrbitHeight } = this.params

    // 计算太阳角度 (0.22-0.78 映射到 0-PI)
    let sunAngle = 0
    if (t >= 0.22 && t <= 0.78) {
      // 白天：太阳从东到西
      sunAngle = ((t - 0.22) / (0.78 - 0.22)) * Math.PI
    }
    else {
      // 夜间：太阳在地平线以下（不渲染）
      sunAngle = t < 0.22 ? 0 : Math.PI
    }

    // 计算太阳位置
    const sunX = Math.cos(sunAngle) * sunOrbitRadius
    const sunY = Math.sin(sunAngle) * sunOrbitHeight
    const sunZ = 0 // 太阳沿 X-Y 平面移动

    // 更新 Environment 的太阳偏移参数
    environment.params.sunPos.x = sunX
    environment.params.sunPos.y = Math.max(sunY, -20) // 不让太阳完全消失
    environment.params.sunPos.z = sunZ

    // 如果有玩家，位置会在 Environment.update() 中自动跟随
    environment.updateSunLightPosition()
  }

  /**
   * 更新月光（平滑过渡）
   */
  _updateMoonLight() {
    const t = this.params.timeOfDay

    // 月光强度曲线：
    // - 白天 (0.28-0.70): 强度 = 0
    // - 黄昏过渡 (0.70-0.85): 强度从 0 渐变到 max
    // - 夜间 (0.85-0.22): 强度 = max
    // - 黎明过渡 (0.22-0.28): 强度从 max 渐变到 0
    let moonFactor = 0

    if (t >= 0.28 && t <= 0.70) {
      // 白天：无月光
      moonFactor = 0
    }
    else if (t > 0.70 && t < 0.85) {
      // 黄昏过渡：月光渐亮
      const fadeIn = (t - 0.70) / 0.15
      moonFactor = fadeIn * fadeIn * (3 - 2 * fadeIn) // smoothstep
    }
    else if (t >= 0.85 || t < 0.22) {
      // 深夜：满月光
      moonFactor = 1
    }
    else if (t >= 0.22 && t < 0.28) {
      // 黎明过渡：月光渐暗
      const fadeOut = 1 - (t - 0.22) / 0.06
      moonFactor = fadeOut * fadeOut * (3 - 2 * fadeOut) // smoothstep
    }

    this.moonLight.intensity = this.params.moonIntensity * moonFactor
    this.moonLight.color.set(this.params.moonColor)
  }

  /**
   * 更新天空盒（使用 SkyDome 平滑过渡）
   */
  _updateSkybox() {
    const { phase, progress, nextPhase } = this._getPhaseInfo()

    const currentTex = this.skyTextures[phase]
    const nextTex = this.skyTextures[nextPhase]

    if (!currentTex || !nextTex || !this.skyDome)
      return

    // 设置贴图
    this.skyDome.setTextures(currentTex, nextTex)

    // 全程 smoothstep 过渡：缓入缓出，更自然的天空变化
    const mixFactor = progress * progress * (3 - 2 * progress)

    this.skyDome.setMixFactor(mixFactor)
  }

  /**
   * 更新光照和雾气（插值过渡）
   */
  _updateLightingAndFog(environment) {
    if (!environment)
      return

    const { phase, progress, nextPhase } = this._getPhaseInfo()

    const currentConfig = this.phaseConfig[phase]
    const nextConfig = this.phaseConfig[nextPhase]

    if (!currentConfig || !nextConfig)
      return

    // 延迟过渡曲线：前 70% 保持 current phase，后 30% 快速 smoothstep 过渡到 next phase
    // 这样光照/雾气会在阶段末期才开始变化，更符合"以当前时段为准"的感觉
    let smoothProgress = 0
    if (progress > 0.7) {
      smoothProgress = (progress - 0.7) / 0.3
      smoothProgress = smoothProgress * smoothProgress * (3 - 2 * smoothProgress)
    }

    // 插值太阳光强度和颜色
    const sunIntensity = this._lerp(currentConfig.sunIntensity, nextConfig.sunIntensity, smoothProgress)
    const sunColor = this._lerpColor(currentConfig.sunColor, nextConfig.sunColor, smoothProgress)

    environment.params.sunIntensity = sunIntensity
    environment.sunLight.intensity = sunIntensity
    environment.sunLight.color.copy(sunColor)

    // 插值环境光
    const ambientIntensity = this._lerp(currentConfig.ambientIntensity, nextConfig.ambientIntensity, smoothProgress)
    const ambientColor = this._lerpColor(currentConfig.ambientColor, nextConfig.ambientColor, smoothProgress)

    environment.params.ambientIntensity = ambientIntensity
    environment.ambientLight.intensity = ambientIntensity
    environment.ambientLight.color.copy(ambientColor)

    // 插值雾气
    const fogDensity = this._lerp(currentConfig.fog.density, nextConfig.fog.density, smoothProgress)
    const fogColor = this._lerpColor(currentConfig.fog.color, nextConfig.fog.color, smoothProgress)

    environment.params.fogDensity = fogDensity
    environment.params.fogColor = `#${fogColor.getHexString()}`
    environment.fog.density = fogDensity
    environment.fog.color.copy(fogColor)
  }

  /**
   * 每帧更新
   * @param {Environment} environment - Environment 实例引用
   */
  update(environment) {
    const now = performance.now()
    const delta = now - this._lastTime
    this._lastTime = now

    // 自动播放时更新时间
    if (this.params.autoPlay) {
      // 计算时间增量
      const timeIncrement = (delta / this.params.dayDuration) * this.params.timeSpeed
      this.params.timeOfDay += timeIncrement

      // 检测是否跨过新的一天
      if (this.params.timeOfDay >= 1.0) {
        this.params.timeOfDay = this.params.timeOfDay % 1.0
        this.hud.incrementGameDay()
      }
    }

    // 更新 HUD 时间显示
    this.hud.updateGameTime(this.params.timeOfDay)

    // 更新太阳位置
    this._updateSunPosition(environment)

    // 更新月光
    this._updateMoonLight()

    // 更新天空盒
    this._updateSkybox()

    // 更新天空球位置（跟随相机）
    if (this.skyDome) {
      const camera = this.experience.camera.instance
      this.skyDome.update(camera.position)
    }

    // 更新光照和雾气
    this._updateLightingAndFog(environment)
  }

  /**
   * 调试面板
   */
  debugInit() {
    const dayCycleFolder = this.debug.addFolder({
      title: 'Day Cycle',
      expanded: true,
    })

    // 时间控制
    dayCycleFolder.addBinding(this.params, 'timeOfDay', {
      label: 'Time of Day',
      min: 0,
      max: 1,
      step: 0.001,
    })

    dayCycleFolder.addBinding(this.params, 'autoPlay', {
      label: 'Auto Play',
    })

    dayCycleFolder.addBinding(this.params, 'timeSpeed', {
      label: 'Time Speed',
      min: 0.1,
      max: 100,
      step: 0.1,
    })

    dayCycleFolder.addBinding(this.params, 'dayDuration', {
      label: 'Day Duration (ms)',
      min: 10000, // 10 秒
      max: 3600000, // 1 小时
      step: 10000,
    })

    // 太阳轨道
    const sunFolder = dayCycleFolder.addFolder({
      title: 'Sun Orbit',
      expanded: false,
    })

    sunFolder.addBinding(this.params, 'sunOrbitRadius', {
      label: 'Orbit Radius',
      min: 50,
      max: 200,
      step: 5,
    })

    sunFolder.addBinding(this.params, 'sunOrbitHeight', {
      label: 'Orbit Height',
      min: 30,
      max: 150,
      step: 5,
    })

    // 月光
    const moonFolder = dayCycleFolder.addFolder({
      title: 'Moon Light',
      expanded: false,
    })

    moonFolder.addBinding(this.params, 'moonIntensity', {
      label: 'Intensity',
      min: 0,
      max: 2,
      step: 0.05,
    })

    moonFolder.addBinding(this.params, 'moonColor', {
      label: 'Color',
      view: 'color',
    })

    // ===== 时段光照配置面板 =====
    const phaseLightingFolder = dayCycleFolder.addFolder({
      title: 'Phase Lighting',
      expanded: false,
    })

    // 为每个时段创建子面板
    const phaseNames = ['sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk', 'midnight']
    const phaseLabels = {
      sunrise: '🌅 Sunrise',
      morning: '🌤️ Morning',
      noon: '☀️ Noon',
      afternoon: '🌤️ Afternoon',
      sunset: '🌇 Sunset',
      dusk: '🌆 Dusk',
      midnight: '🌙 Midnight',
    }

    for (const phaseName of phaseNames) {
      const config = this.phaseConfig[phaseName]
      const phaseFolder = phaseLightingFolder.addFolder({
        title: phaseLabels[phaseName],
        expanded: false,
      })

      // 太阳光
      phaseFolder.addBinding(config, 'sunIntensity', {
        label: 'Sun Intensity',
        min: 0,
        max: 3,
        step: 0.05,
      })

      phaseFolder.addBinding(config, 'sunColor', {
        label: 'Sun Color',
        view: 'color',
      })

      // 环境光
      phaseFolder.addBinding(config, 'ambientIntensity', {
        label: 'Ambient Intensity',
        min: 0,
        max: 2,
        step: 0.05,
      })

      phaseFolder.addBinding(config, 'ambientColor', {
        label: 'Ambient Color',
        view: 'color',
      })

      // 雾气
      phaseFolder.addBinding(config.fog, 'density', {
        label: 'Fog Density',
        min: 0,
        max: 0.05,
        step: 0.001,
      })

      phaseFolder.addBinding(config.fog, 'color', {
        label: 'Fog Color',
        view: 'color',
      })
    }

    // 快捷时间按钮
    const presetsFolder = dayCycleFolder.addFolder({
      title: 'Time Presets',
      expanded: false,
    })

    presetsFolder.addButton({ title: 'Sunrise (6:00)' }).on('click', () => {
      this.params.timeOfDay = 0.25
    })
    presetsFolder.addButton({ title: 'Morning (9:00)' }).on('click', () => {
      this.params.timeOfDay = 0.375
    })
    presetsFolder.addButton({ title: 'Noon (12:00)' }).on('click', () => {
      this.params.timeOfDay = 0.50
    })
    presetsFolder.addButton({ title: 'Afternoon (15:00)' }).on('click', () => {
      this.params.timeOfDay = 0.625
    })
    presetsFolder.addButton({ title: 'Sunset (18:00)' }).on('click', () => {
      this.params.timeOfDay = 0.75
    })
    presetsFolder.addButton({ title: 'Dusk (20:00)' }).on('click', () => {
      this.params.timeOfDay = 0.833
    })
    presetsFolder.addButton({ title: 'Midnight (00:00)' }).on('click', () => {
      this.params.timeOfDay = 0.0
    })
  }

  /**
   * 销毁资源
   */
  destroy() {
    if (this.skyDome) {
      this.skyDome.destroy()
    }
    if (this.moonLight) {
      this.scene.remove(this.moonLight)
    }
  }
}
