/** Buttons that can be sent to the server via camera input. */
export const CameraButtons = {
  NONE: 0,
  FORWARD: 2,
  BACKWARD: 4,
  LEFT: 8,
  RIGHT: 16,
  JUMP: 32,
  DUCK: 64,
  SPRINT: 128,
  USE: 256,
  FIRE_PRIMARY: 1024,
  FIRE_SECONDARY: 2048,
  RELOAD: 8192,
  FIRE_THIRD: 134217728,
} as const;

/**
 * Control flags reported by the server for a subscribed camera, e.g. static CCTV
 * cameras will not report MOVEMENT support.
 */
export const CameraControlFlags = {
  NONE: 0,
  MOVEMENT: 1,
  MOUSE: 2,
  SPRINT_AND_DUCK: 4,
  FIRE: 8,
  RELOAD: 16,
  CROSSHAIR: 32,
} as const;
