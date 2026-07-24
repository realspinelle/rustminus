import { AppEntityType } from "../generated/rustplus.js";
import type { RustPlusOptions } from "../client/types.js";
import type { FcmDataMessage } from "./types.js";

/**
 * The JSON payload Facepunch puts in the FCM `body` field. This is an undocumented,
 * loosely-structured format reverse engineered from the Rust+ companion app - every field is
 * optional here because presence varies by `channelId`/`type`, and Facepunch is free to change it.
 *
 * `ip`/`port`/`playerId`/`playerToken`/`name`/`desc`/`img`/`logo`/`url` are present on every
 * `pairing` notification (both `type: "server"` and `type: "entity"`), confirmed live.
 */
export interface FcmNotificationBody {
  /** Notification/server UUID, distinct from the top-level FCM message id. */
  id?: string;
  type?: string;
  ip?: string;
  port?: string;
  playerId?: string;
  /** Confirmed live: sent as a numeric string (e.g. "262484638"), not a JSON number. */
  playerToken?: string;
  /** Confirmed live: sent as a numeric string (e.g. "16183266"), not a JSON number. */
  entityId?: string;
  /** Confirmed live: numeric string matching {@link AppEntityType} (e.g. "1" for a Smart Switch). */
  entityType?: string;
  entityName?: string;
  name?: string;
  desc?: string;
  img?: string;
  logo?: string;
  url?: string;
  targetId?: string;
  targetName?: string;
  [key: string]: unknown;
}

export interface RustPlusNotification {
  title: string;
  message: string;
  channelId: string;
  body: FcmNotificationBody;
}

export type RustPlusNotificationKind =
  | "pairing-server"
  | "pairing-entity"
  | "alarm"
  | "team-login"
  | "player-death"
  | "unknown";

/**
 * Extracts and parses the Rust+-specific fields out of a raw FCM data message.
 * Returns undefined if this doesn't look like a Rust+ notification (missing/unparseable fields).
 */
export function parseNotification(data: FcmDataMessage): RustPlusNotification | undefined {
  const appData = data.appData;
  if (!appData) {
    return undefined;
  }

  const title = appData.find((item) => item.key === "title")?.value;
  const message = appData.find((item) => item.key === "message")?.value;
  const channelId = appData.find((item) => item.key === "channelId")?.value;
  const rawBody = appData.find((item) => item.key === "body")?.value;

  if (title === undefined || message === undefined || channelId === undefined || rawBody === undefined) {
    return undefined;
  }

  let body: FcmNotificationBody;
  try {
    body = JSON.parse(rawBody) as FcmNotificationBody;
  } catch {
    return undefined;
  }

  return { title, message, channelId, body };
}

/** Classifies a parsed notification by its (channelId, body.type) pair, for switch-style handling. */
export function classifyNotification(notification: RustPlusNotification): RustPlusNotificationKind {
  switch (notification.channelId) {
    case "pairing":
      if (notification.body.type === "server") return "pairing-server";
      if (notification.body.type === "entity") return "pairing-entity";
      return "unknown";
    case "alarm":
      return notification.body.type === "alarm" ? "alarm" : "unknown";
    case "team":
      return notification.body.type === "login" ? "team-login" : "unknown";
    case "player":
      return notification.body.type === "death" ? "player-death" : "unknown";
    default:
      return "unknown";
  }
}

/** Parses `entityType` into the generated {@link AppEntityType} enum, if it's a recognized value. */
export function parseEntityType(body: FcmNotificationBody): AppEntityType | undefined {
  if (body.entityType === undefined) {
    return undefined;
  }
  const value = Number(body.entityType);
  return value in AppEntityType ? (value as AppEntityType) : undefined;
}

/**
 * Builds RustPlusOptions from a pairing notification body (`server` or `entity` - both carry the
 * server connection fields), ready to hand to `new RustPlus(...)`. Returns undefined if the body
 * is missing the required fields.
 */
export function pairingToRustPlusOptions(body: FcmNotificationBody): RustPlusOptions | undefined {
  if (body.ip === undefined || body.port === undefined || body.playerId === undefined || body.playerToken === undefined) {
    return undefined;
  }

  return {
    server: body.ip,
    port: Number(body.port),
    playerId: body.playerId,
    playerToken: Number(body.playerToken),
  };
}
