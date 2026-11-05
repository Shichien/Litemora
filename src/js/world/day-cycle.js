import * as THREE from 'three'

import Experience from '../experience.js'
import SkyDome from './sky-dome.js'

// 单帧最大时间步长（ms）
const MAX_FRAME_DELTA_MS = 100

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

    // 时段配置（程序化天空，共 7 个时段）
    this.phaseConfig = {
      sunrise: {
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

    // 内部状态
    this._lastTime = performance.now()
    this._sunOffset = new THREE.Vector3(0, this.params.sunOrbitHeight, 0)
    this._moonOffset = new THREE.Vector3(0, -this.params.sunOrbitHeight * 0.65, 0)

    // 颜色缓存：常量颜色按 hex 只解析一次，插值结果写入复用的临时对象，避免每帧分配
    this._constantColors = new Map()
    this._scratchColors = {
      horizonDay: new THREE.Color(),
      zenithDay: new THREE.Color(),
      horizonNight: new THREE.Color(),
      zenithNight: new THREE.Color(),
      skySun: new THREE.Color(),
      skySunTint: new THREE.Color(),
      lightSun: new THREE.Color(),
      ambient: new THREE.Color(),
      fog: new THREE.Color(),
    }

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
   * 获取按 hex 缓存的常量颜色（只读，勿修改返回值）
   */
  _getConstantColor(hex) {
    let color = this._constantColors.get(hex)
    if (!color) {
      color = new THREE.Color(hex)
      this._constantColors.set(hex, color)
    }
    return color
  }

  /**
   * 线性插值两个颜色，结果写入 target
   */
  _lerpColor(colorA, colorB, t, target) {
    return target.copy(this._getConstantColor(colorA)).lerp(this._getConstantColor(colorB), t)
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
    const sunsetGlow = this._smoothstep(0.66, 0.73, this.params.timeOfDay) * (1 - this._smoothstep(0.79, 0.86, this.params.timeOfDay))
    const duskGlow = this._smoothstep(0.76, 0.82, this.params.timeOfDay) * (1 - this._smoothstep(0.87, 0.93, this.params.timeOfDay))
    const starsStrength = (1 - daylight) * (1 - twilight * 0.8)
    return {
      orbitAngle,
      sunHeight,
      daylight,
      twilight,
      sunsetGlow,
      duskGlow,
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

    const { daylight, twilight, sunsetGlow, duskGlow, starsStrength } = this._getCelestialState()
    const sunDirection = this._sunOffset.clone().normalize()
    const moonDirection = this._moonOffset.clone().normalize()

    const warmTwilight = THREE.MathUtils.clamp((twilight * 0.45) + (sunsetGlow * 0.95), 0, 1)
    const duskCool = THREE.MathUtils.clamp((twilight * 0.2) + (duskGlow * 0.92), 0, 1)
    const scratch = this._scratchColors
    const horizonDay = this._lerpColor('#dcecff', '#ff9354', warmTwilight, scratch.horizonDay)
    const zenithDay = this._lerpColor('#78b4ff', '#f2a35b', warmTwilight * 0.34, scratch.zenithDay)
    const horizonNight = this._lerpColor('#182744', '#5d2f33', duskCool * 0.75, scratch.horizonNight)
    const zenithNight = this._lerpColor('#061120', '#15233a', duskCool * 0.42, scratch.zenithNight)
    const sunColor = this._lerpColor('#fff7d6', '#ff9356', warmTwilight, scratch.skySun)
      .lerp(this._lerpColor('#ff9356', '#f07bb3', duskCool * 0.38, scratch.skySunTint), duskCool * 0.32)

    this.skyDome.setSkyState({
      zenithDayColor: `#${zenithDay.getHexString()}`,
      horizonDayColor: `#${horizonDay.getHexString()}`,
      zenithNightColor: `#${zenithNight.getHexString()}`,
      horizonNightColor: `#${horizonNight.getHexString()}`,
      sunDirection,
      moonDirection,
      sunColor: `#${sunColor.getHexString()}`,
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
   * 按当前时段计算光照和雾气，并乘以用户设置的倍率 (environment.lightingScale)。
   * 只写入灯光/雾对象，不覆盖 environment.params 里的用户设置值。
   */
  applyLighting(environment) {
    if (!environment?.sunLight)
      return

    const scale = environment.lightingScale || { sun: 1, ambient: 1, fog: 1 }
    const { daylight, twilight, sunsetGlow, duskGlow } = this._getCelestialState()
    const warmTint = THREE.MathUtils.clamp((twilight * 0.52) + (sunsetGlow * 0.96), 0, 1)
    const coolTwilight = THREE.MathUtils.clamp(duskGlow * 0.82, 0, 1)
    const sunIntensity = this._lerp(0.04, 1.65, daylight) + (twilight * 0.14) + (sunsetGlow * 0.2) - (duskGlow * 0.08)
    const scratch = this._scratchColors
    const sunColor = this._lerpColor('#ffffff', '#ff9a58', warmTint, scratch.lightSun)
      .lerp(this._getConstantColor('#e58ab7'), coolTwilight * 0.24)

    environment.sunLight.intensity = sunIntensity * scale.sun
    environment.sunLight.color.copy(sunColor)

    const ambientIntensity = this._lerp(0.16, 0.72, daylight) + (twilight * 0.06) + (sunsetGlow * 0.05)
    const ambientColor = this._lerpColor('#455a78', '#ffffff', daylight, scratch.ambient)
      .lerp(this._getConstantColor('#ffbb84'), sunsetGlow * 0.22)
      .lerp(this._getConstantColor('#6a7fb1'), duskGlow * 0.24)

    environment.ambientLight.intensity = ambientIntensity * scale.ambient
    environment.ambientLight.color.copy(ambientColor)

    const fogDensity = this._lerp(0.022, 0.008, daylight) + (duskGlow * 0.002)
    const fogColor = this._lerpColor('#141820', '#9fd0ff', daylight, scratch.fog)
      .lerp(this._getConstantColor('#ff9153'), warmTint * 0.4)
      .lerp(this._getConstantColor('#5b4770'), duskGlow * 0.45)

    environment.fog.density = fogDensity * scale.fog
    environment.fog.color.copy(fogColor)
  }

  /**
   * 每帧更新
   * @param {Environment} environment - Environment 实例引用
   */
  update(environment) {
    const now = performance.now()
    // 暂停或标签页隐藏期间不调用 update；限制单帧步长，避免恢复时时间突然跳变
    const delta = Math.min(now - this._lastTime, MAX_FRAME_DELTA_MS)
    this._lastTime = now

    // 自动播放时更新时间
    if (this.params.autoPlay) {
      // 计算时间增量
      const timeIncrement = (delta / this.params.dayDuration) * this.params.timeSpeed
      this.params.timeOfDay += timeIncrement

      // 跨过新的一天时回绕
      if (this.params.timeOfDay >= 1.0) {
        this.params.timeOfDay = this.params.timeOfDay % 1.0
      }
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
    this.applyLighting(environment)
  }

  setTimeOfDay(value) {
    const clamped = THREE.MathUtils.clamp(Number(value), 0, 1)
    if (!Number.isFinite(clamped)) {
      return
    }

    this.params.timeOfDay = clamped
  }

  setAutoPlay(value) {
    this.params.autoPlay = !!value
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
