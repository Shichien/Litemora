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

    // 时段配置（与贴图对应，共 7 个时段）
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
    this._sunOffset = new THREE.Vector3(0, this.params.sunOrbitHeight, 0)
    this._moonOffset = new THREE.Vector3(0, -this.params.sunOrbitHeight * 0.65, 0)

    // HUD 时间更新节流：每 5 分钟游戏时间更新一次 (timeOfDay 精度)
    // 5 分钟 = 5/(24*60) = 1/288 ≈ 0.00347 (timeOfDay 范围 0-1)
    this._hudUpdateInterval = 5 / (24 * 60) // 5 分钟对应 timeOfDay 增量
    this._lastHudTimeOfDay = this.params.timeOfDay // 上次更新 HUD 时的 timeOfDay

    // 创建天空球（替代 scene.background）
    this.skyDome = new SkyDome()
    this._updateSkybox()

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
  }

  /**
   * 初始化天空球贴图
   */
  _initSkyDome() {
    this._updateSkybox()
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

  _smoothstep(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  _getCelestialState() {
    const orbitAngle = (this.params.timeOfDay - 0.25) * Math.PI * 2
    const sunHeight = Math.sin(orbitAngle)
    const daylight = this._smoothstep(-0.14, 0.18, sunHeight)
    const twilight = (1 - this._smoothstep(0.05, 0.42, Math.abs(sunHeight))) * (1 - daylight * 0.55)
    const starsStrength = (1 - daylight) * (1 - twilight * 0.8)
    return {
      orbitAngle,
      sunHeight,
      daylight,
      twilight,
      starsStrength,
    }
  }

  /**
   * 更新太阳位置（弧形轨迹）
   */
  _updateSunPosition(environment) {
    if (!environment || !environment.sunLight)
      return

    const { sunOrbitRadius, sunOrbitHeight } = this.params
    const { orbitAngle } = this._getCelestialState()

    const sunX = Math.cos(orbitAngle) * sunOrbitRadius
    const sunY = Math.sin(orbitAngle) * sunOrbitHeight
    const sunZ = Math.sin(orbitAngle * 0.35) * sunOrbitRadius * 0.2

    this._sunOffset.set(sunX, sunY, sunZ)
    environment.params.sunPos.x = sunX
    environment.params.sunPos.y = sunY
    environment.params.sunPos.z = sunZ
  }

  /**
   * 更新月光（平滑过渡）
   */
  _updateMoonLight() {
    const { orbitAngle, daylight, twilight } = this._getCelestialState()
    const moonFactor = THREE.MathUtils.clamp((1 - daylight) * (1 - twilight * 0.55), 0, 1)
    const moonOrbitAngle = orbitAngle + Math.PI
    const moonX = Math.cos(moonOrbitAngle) * this.params.sunOrbitRadius
    const moonY = Math.sin(moonOrbitAngle) * this.params.sunOrbitHeight * 0.82
    const moonZ = Math.sin(moonOrbitAngle * 0.35) * this.params.sunOrbitRadius * 0.2

    this._moonOffset.set(moonX, moonY, moonZ)

    this.moonLight.intensity = this.params.moonIntensity * moonFactor
    this.moonLight.color.set(this.params.moonColor)
  }

  /**
   * 更新天空盒（使用程序化 SkyDome）
   */
  _updateSkybox() {
    if (!this.skyDome)
      return

    const { daylight, twilight, starsStrength } = this._getCelestialState()
    const sunDirection = this._sunOffset.clone().normalize()
    const moonDirection = this._moonOffset.clone().normalize()

    const horizonDay = this._lerpColor('#dcecff', '#ffb56f', twilight * 0.82)
    const zenithDay = this._lerpColor('#78b4ff', '#f3a067', twilight * 0.22)
    const horizonNight = this._lerpColor('#182744', '#4a2f34', twilight * 0.22)
    const zenithNight = this._lerpColor('#061120', '#0f1523', twilight * 0.08)

    this.skyDome.setSkyState({
      zenithDayColor: `#${zenithDay.getHexString()}`,
      horizonDayColor: `#${horizonDay.getHexString()}`,
      zenithNightColor: `#${zenithNight.getHexString()}`,
      horizonNightColor: `#${horizonNight.getHexString()}`,
      sunDirection,
      moonDirection,
      sunColor: `#${this._lerpColor('#fff7d6', '#ff9f5c', twilight * 0.9).getHexString()}`,
      moonColor: this.params.moonColor,
      dayFactor: daylight,
      twilightFactor: twilight,
      starsStrength,
      sunDiscSize: 0.028,
      sunGlowSize: 0.16,
      moonDiscSize: 0.022,
      moonGlowSize: 0.09,
    })
  }

  /**
   * 更新光照和雾气（插值过渡）
   */
  _updateLightingAndFog(environment) {
    if (!environment)
      return

    const { daylight, twilight } = this._getCelestialState()
    const warmTint = twilight * 0.88
    const sunIntensity = this._lerp(0.04, 1.65, daylight) + (twilight * 0.18)
    const sunColor = this._lerpColor('#ffffff', '#ffab6b', warmTint)

    environment.params.sunIntensity = sunIntensity
    environment.sunLight.intensity = sunIntensity
    environment.sunLight.color.copy(sunColor)

    const ambientIntensity = this._lerp(0.16, 0.72, daylight) + (twilight * 0.08)
    const ambientColor = this._lerpColor('#455a78', '#ffffff', daylight)

    environment.params.ambientIntensity = ambientIntensity
    environment.ambientLight.intensity = ambientIntensity
    environment.ambientLight.color.copy(ambientColor)

    const fogDensity = this._lerp(0.022, 0.008, daylight)
    const baseFog = this._lerpColor('#141820', '#9fd0ff', daylight)
    const fogColor = baseFog.lerp(new THREE.Color('#ffab6b'), twilight * 0.35)

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

    // 更新 HUD 时间显示（每 5 分钟游戏时间更新一次）
    const timeOfDayDiff = Math.abs(this.params.timeOfDay - this._lastHudTimeOfDay)
    // 处理跨天的情况（例如从 0.99 到 0.01）
    const wrappedDiff = Math.min(timeOfDayDiff, 1 - timeOfDayDiff)
    if (wrappedDiff >= this._hudUpdateInterval) {
      this.hud.updateGameTime(this.params.timeOfDay)
      this._lastHudTimeOfDay = this.params.timeOfDay
    }

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

  getCelestialOffsets() {
    return {
      sun: this._sunOffset.clone(),
      moon: this._moonOffset.clone(),
    }
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
