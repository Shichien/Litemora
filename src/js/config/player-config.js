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
  jumpForce: 10.2,
  physics: {
    tickRate: 20,
    maxTickDelta: 0.25,
    jumpCoyoteTime: 0.1,
    verticalDrag: 0.98,
    gravityPerTick: 1.6,
    groundFriction: 0.546,
    airDrag: 0.91,
    response: {
      crouch: 0.28,
      walk: 0.34,
      run: 0.4,
      air: 0.08,
    },
    sneakSupportDrop: 0.55,
    snapToGroundDistance: 0.14,
    autoStepHeight: 0.6,
    jumpClimbHeight: 0.35,
    sprintJumpBoost: 4.0,
    minWorldY: 0,
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
      eyeHeight: 1.445,
    },
  },
  facingAngle: Math.PI,
  mouseSensitivity: 0.002,
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
