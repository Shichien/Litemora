// Player movement direction weights
// These constants determine the influence of each input direction before normalization
// For example, a lower backward weight means backward diagonal movement will be more sideways than backward

export const MOVEMENT_DIRECTION_WEIGHTS = {
  FORWARD: 1.0,
  BACKWARD: 1.0,
  LEFT: 1.0,
  RIGHT: 1.0,
}

export const MOVEMENT_CONSTANTS = {
  COMBAT_DECELERATION: 0.9,
}

// 玩家默认配置（数值集中管理，便于调优）
export const PLAYER_CONFIG = {
  speed: {
    crouch: 1.295,
    walk: 4.317,
    run: 5.612,
  },
  // 方向速率倍率：区分档位以便精细调参
  directionMultiplier: {
    crouch: {
      lateral: 1.0,
      backward: 1.0,
    },
    walk: {
      lateral: 1.0,
      backward: 1.0,
    },
    run: {
      lateral: 1.0,
      backward: 1.0,
    },
  },
  // m/s at the start of the jump tick (MC jump strength 0.42 b/t * 20).
  // Gravity is applied after the move, as in LivingEntity.travelInAir.
  jumpForce: 8.4,
  physics: {
    tickRate: 20,
    maxTickDelta: 0.25,
    jumpCoyoteTime: 0.1,
    // MC LivingEntity: noJumpDelay after a jump while Space stays held
    jumpDelayTicks: 10,
    // MC LocalPlayer: double-tap Space window that toggles creative flight
    flightToggleWindowTicks: 7,
    verticalDrag: 0.98,
    gravityPerTick: 1.6,
    // MC block friction (0.6) * air drag (0.91)
    groundFriction: 0.546,
    airDrag: 0.91,
    // MC input friction: move input is scaled by 0.98 before it is applied
    inputFriction: 0.98,
    // Velocity components below this (m/s) are zeroed (MC 0.003 b/t)
    minVelocity: 0.06,
    sneakSupportDrop: 0.55,
    snapToGroundDistance: 0.14,
    autoStepHeight: 0.6,
    jumpClimbHeight: 0.35,
    sprintJumpBoost: 4.0,
    minWorldY: 0,
    // Per-tick easing of eye height and FOV modifier (MC Camera)
    eyeHeightEase: 0.5,
  },
  pose: {
    standing: {
      radius: 0.3,
      height: 1.8,
      eyeHeight: 1.62,
    },
    crouching: {
      radius: 0.3,
      height: 1.5,
      eyeHeight: 1.27,
    },
  },
  facingAngle: Math.PI,
  // rad per mouse pixel at the default settings value (MC default 0.15 deg/px)
  mouseSensitivity: 0.15 * Math.PI / 180,
  turnSmoothing: 0.10,
  respawn: {
    thresholdY: -2,
    position: { x: 0, y: 0, z: 0 },
  },
  speedLines: {
    fadeInSpeed: 5.0,
    fadeOutSpeed: 3.0,
    targetOpacity: 0.8,
  },
}
