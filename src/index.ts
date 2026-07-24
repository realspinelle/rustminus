export { RustPlus } from "./client/RustPlus.js";
export type { RustPlusOptions, RustPlusRequestData, RustPlusEvents, SeqCallback } from "./client/types.js";
export type { TeamDiffEvent } from "./client/teamDiff.js";

export { Camera } from "./camera/Camera.js";
export type { CameraEvents } from "./camera/Camera.js";
export { CameraButtons, CameraControlFlags } from "./camera/CameraButtons.js";

export { FcmRegistration } from "./fcm/fcmRegister.js";
export type { FcmRegisterEvents } from "./fcm/fcmRegister.js";
export { FcmListener } from "./fcm/FcmListener.js";
export type { FcmListenerEvents } from "./fcm/FcmListener.js";
export { linkSteamWithRustPlus, closeSteamPairingBrowser } from "./fcm/steamPairing.js";
export { readConfig, writeConfig } from "./fcm/config.js";
export type {
  FcmCredentials,
  FcmGcmCredentials,
  FcmTokenCredentials,
  FcmDataMessage,
  RustPlusPairingCredentials,
} from "./fcm/types.js";
export {
  parseNotification,
  classifyNotification,
  parseEntityType,
  pairingToRustPlusOptions,
} from "./fcm/notification.js";
export type { FcmNotificationBody, RustPlusNotification, RustPlusNotificationKind } from "./fcm/notification.js";

export { TypedEventEmitter } from "./util/TypedEventEmitter.js";
export type { EventMap } from "./util/TypedEventEmitter.js";

export * from "./generated/rustplus.js";
