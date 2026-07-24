import type { AppEntityPayload, AppMessage, AppRequest, AppTeamInfo, AppTeamMessage } from "../generated/rustplus.js";
import type { TeamDiffEvent } from "./teamDiff.js";

export interface RustPlusOptions {
  /** IP address or hostname of the Rust server */
  server: string;
  /** Port of the Rust server (app.port in server.cfg) */
  port: number;
  /** SteamId of the player. Accepts a string/number/bigint since Steam64 ids exceed Number.MAX_SAFE_INTEGER. */
  playerId: string | number | bigint;
  /** Player token obtained from Server Pairing */
  playerToken: number;
  /** Use Facepunch's secure websocket proxy instead of connecting to the Rust server directly */
  useFacepunchProxy?: boolean;
  /** Override how the underlying WebSocket is constructed. Mainly useful for testing. */
  createWebSocket?: (address: string) => WebSocket;
  /**
   * When true, polls getTeamInfo() on an interval (in addition to reacting to `teamChanged`
   * broadcasts) and diffs snapshots against the previous one, feeding the diff into the
   * `teamChanged` event alongside the raw AppTeamInfo. Off by default. Confirmed live against a
   * real server: `teamChanged` broadcasts alone are not reliable - a death with a fast respawn
   * produced no broadcast of its own, so polling is what actually guarantees a change gets
   * noticed (same approach rustplusplus itself relies on).
   */
  trackTeam?: boolean;
  /** Poll interval for team tracking, in milliseconds. Only used when trackTeam is true. */
  teamPollIntervalMs?: number;
}

/** Fields of AppRequest that a caller may set; seq/playerId/playerToken are managed by RustPlus itself. */
export type RustPlusRequestData = Omit<AppRequest, "seq" | "playerId" | "playerToken">;

export type SeqCallback = (message: AppMessage) => boolean | void;

export type RustPlusEvents = {
  connecting: [];
  connected: [];
  disconnected: [];
  error: [Error];
  request: [AppRequest];
  message: [AppMessage];
  /**
   * Fires whenever fresh team info is available - both from a real `teamChanged` broadcast and
   * (when `trackTeam` is enabled) from each successful poll. `changes` is empty on the very first
   * snapshot (nothing to diff against yet).
   */
  teamChanged: [teamInfo: AppTeamInfo, changes: TeamDiffEvent[]];
  /** A new team chat message broadcast. */
  teamMessage: [message: AppTeamMessage];
  /** A paired entity's (switch/alarm/storage monitor) state changed. */
  entityChanged: [entityId: number, payload: AppEntityPayload];
};
