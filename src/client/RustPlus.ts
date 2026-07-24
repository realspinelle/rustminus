import { TypedEventEmitter } from "../util/TypedEventEmitter.js";
import { Camera } from "../camera/Camera.js";
import { diffTeamInfo } from "./teamDiff.js";
import {
  AppMessage,
  AppRequest,
  type AppCameraInfo,
  type AppClanInfo,
  type AppEntityInfo,
  type AppInfo,
  type AppMap,
  type AppMapMarkers,
  type AppMarker,
  type AppNexusAuth,
  type AppResponse,
  type AppTeamInfo,
  type AppTime,
  type ClanInfo,
  type AppClanMessage,
  type AppTeamMessage,
} from "../generated/rustplus.js";
import type { RustPlusEvents, RustPlusOptions, RustPlusRequestData, SeqCallback } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TEAM_POLL_INTERVAL_MS = 5_000;

export class RustPlus extends TypedEventEmitter<RustPlusEvents> {
  readonly server: string;
  readonly port: number;
  readonly playerId: string;
  readonly playerToken: number;
  readonly useFacepunchProxy: boolean;

  private websocket: WebSocket | undefined;
  private seq = 0;
  private readonly seqCallbacks = new Map<number, SeqCallback>();
  private readonly createWebSocket: (address: string) => WebSocket;

  private readonly trackTeam: boolean;
  private readonly teamPollIntervalMs: number;
  private teamPollInterval: ReturnType<typeof setInterval> | undefined;
  private previousTeamInfo: AppTeamInfo | undefined;
  private teamPolling = false;

  constructor(options: RustPlusOptions) {
    super();
    this.server = options.server;
    this.port = options.port;
    this.playerId = String(options.playerId);
    this.playerToken = options.playerToken;
    this.useFacepunchProxy = options.useFacepunchProxy ?? false;
    this.createWebSocket = options.createWebSocket ?? ((address) => new WebSocket(address));
    this.trackTeam = options.trackTeam ?? false;
    this.teamPollIntervalMs = options.teamPollIntervalMs ?? DEFAULT_TEAM_POLL_INTERVAL_MS;
  }

  /**
   * Connect to the Rust Server via WebSocket.
   * Resolves once the connection is open, rejects if the initial connection attempt fails.
   */
  connect(): Promise<void> {
    if (this.websocket) {
      this.disconnect();
    }

    this.emit("connecting");

    const address = this.useFacepunchProxy
      ? `wss://companion-rust.facepunch.com/game/${this.server}/${this.port}`
      : `ws://${this.server}:${this.port}`;

    const socket = this.createWebSocket(address);
    socket.binaryType = "arraybuffer";
    this.websocket = socket;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      socket.addEventListener("open", () => {
        settled = true;
        this.emit("connected");
        if (this.trackTeam) {
          this.startTeamTracking();
        }
        resolve();
      });

      socket.addEventListener("error", (event) => {
        const error = toError(event);
        this.emit("error", error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      socket.addEventListener("message", (event) => {
        if (!(event.data instanceof ArrayBuffer)) {
          return;
        }
        this.handleMessage(new Uint8Array(event.data));
      });

      socket.addEventListener("close", () => {
        this.stopTeamTracking();
        this.emit("disconnected");
      });
    });
  }

  /** Disconnect from the Rust Server. */
  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
  }

  isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: Uint8Array): void {
    const message = AppMessage.decode(data);

    if (message.response) {
      const callback = this.seqCallbacks.get(message.response.seq);
      if (callback) {
        this.seqCallbacks.delete(message.response.seq);
        if (callback(message)) {
          return;
        }
      }
    }

    const teamInfo = message.broadcast?.teamChanged?.teamInfo;
    if (this.trackTeam && teamInfo) {
      this.applyTeamInfoUpdate(teamInfo, "broadcast");
    }

    const teamMessage = message.broadcast?.teamMessage?.message;
    if (teamMessage) {
      this.emit("teamMessage", teamMessage);
    }

    const entityChanged = message.broadcast?.entityChanged;
    if (entityChanged?.payload) {
      this.emit("entityChanged", entityChanged.entityId, entityChanged.payload);
    }

    this.emit("message", message);
  }

  private startTeamTracking(): void {
    if (this.teamPollInterval) {
      return;
    }
    this.teamPollInterval = setInterval(() => void this.pollTeamInfo(), this.teamPollIntervalMs);
    void this.pollTeamInfo();
  }

  private stopTeamTracking(): void {
    if (this.teamPollInterval) {
      clearInterval(this.teamPollInterval);
      this.teamPollInterval = undefined;
    }
    this.previousTeamInfo = undefined;
    this.teamPolling = false;
  }

  private async pollTeamInfo(): Promise<void> {
    if (this.teamPolling) {
      return;
    }
    this.teamPolling = true;
    try {
      const teamInfo = await this.getTeamInfo();
      this.applyTeamInfoUpdate(teamInfo, "poll");
    } catch {
      // e.g. "no_team" - just skip this cycle, the next poll will retry
    } finally {
      this.teamPolling = false;
    }
  }

  /**
   * Broadcasts emit `teamChanged` for whatever they carry (confirmed reliable for join/leave).
   * Polls only exist to catch what broadcasts miss - status changes on an *existing* member
   * (death/respawn, online/offline) rather than a membership change - confirmed live for both
   * death (fast respawn, no broadcast) and disconnect (isOnline flipped false, no broadcast).
   * A poll only emits if the diff contains one of those; otherwise every poll cycle would emit
   * for no meaningful reason (position isn't diffed at all, for the same reason).
   */
  private applyTeamInfoUpdate(teamInfo: AppTeamInfo, source: "broadcast" | "poll"): void {
    const changes = diffTeamInfo(this.previousTeamInfo, teamInfo);
    this.previousTeamInfo = teamInfo;

    const hasPollWorthyChange = changes.some(
      (change) =>
        change.type === "memberDied" ||
        change.type === "memberRespawned" ||
        change.type === "memberWentOnline" ||
        change.type === "memberWentOffline",
    );

    if (source === "broadcast" || hasPollWorthyChange) {
      this.emit("teamChanged", teamInfo, changes);
    }
  }

  /**
   * Send a Request to the Rust Server with an optional callback invoked when the matching Response arrives.
   * Returns the sequence number assigned to the request.
   */
  sendRequest(data: RustPlusRequestData, callback?: SeqCallback): number {
    if (!this.websocket) {
      throw new Error("Cannot send a request while not connected to the Rust Server");
    }

    const seq = ++this.seq;
    if (callback) {
      this.seqCallbacks.set(seq, callback);
    }

    const request: AppRequest = {
      seq,
      playerId: this.playerId,
      playerToken: this.playerToken,
      ...data,
    };

    this.websocket.send(AppRequest.encode(request).finish());
    this.emit("request", request);

    return seq;
  }

  /** Send a Request to the Rust Server and resolve with its Response. */
  sendRequestAsync(data: RustPlusRequestData, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AppResponse> {
    return new Promise<AppResponse>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;

      const seq = this.sendRequest(data, (message) => {
        clearTimeout(timeout);

        if (!message.response) {
          reject(new Error("Rust+ server sent a message without a response body"));
          return true;
        }

        if (message.response.error) {
          reject(new Error(message.response.error.error));
        } else {
          resolve(message.response);
        }

        return true;
      });

      timeout = setTimeout(() => {
        this.seqCallbacks.delete(seq);
        reject(new Error(`Timeout reached while waiting for response to request #${seq}`));
      }, timeoutMs);
    });
  }

  // ---- Convenience, typed, promise-based wrappers -------------------------------------------

  async getInfo(timeoutMs?: number): Promise<AppInfo> {
    const response = await this.sendRequestAsync({ getInfo: {} }, timeoutMs);
    return unwrap(response.info, "info");
  }

  async getTime(timeoutMs?: number): Promise<AppTime> {
    const response = await this.sendRequestAsync({ getTime: {} }, timeoutMs);
    return unwrap(response.time, "time");
  }

  async getMap(timeoutMs?: number): Promise<AppMap> {
    const response = await this.sendRequestAsync({ getMap: {} }, timeoutMs);
    return unwrap(response.map, "map");
  }

  async getMapMarkers(timeoutMs?: number): Promise<AppMarker[]> {
    const response = await this.sendRequestAsync({ getMapMarkers: {} }, timeoutMs);
    return unwrap(response.mapMarkers, "mapMarkers").markers;
  }

  async getTeamInfo(timeoutMs?: number): Promise<AppTeamInfo> {
    const response = await this.sendRequestAsync({ getTeamInfo: {} }, timeoutMs);
    return unwrap(response.teamInfo, "teamInfo");
  }

  async getTeamChat(timeoutMs?: number): Promise<AppTeamMessage[]> {
    const response = await this.sendRequestAsync({ getTeamChat: {} }, timeoutMs);
    return unwrap(response.teamChat, "teamChat").messages;
  }

  async sendTeamMessage(message: string, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ sendTeamMessage: { message } }, timeoutMs);
  }

  async getEntityInfo(entityId: number, timeoutMs?: number): Promise<AppEntityInfo> {
    const response = await this.sendRequestAsync({ entityId, getEntityInfo: {} }, timeoutMs);
    return unwrap(response.entityInfo, "entityInfo");
  }

  async setEntityValue(entityId: number, value: boolean, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ entityId, setEntityValue: { value } }, timeoutMs);
  }

  async turnSmartSwitchOn(entityId: number, timeoutMs?: number): Promise<void> {
    await this.setEntityValue(entityId, true, timeoutMs);
  }

  async turnSmartSwitchOff(entityId: number, timeoutMs?: number): Promise<void> {
    await this.setEntityValue(entityId, false, timeoutMs);
  }

  async checkSubscription(entityId: number, timeoutMs?: number): Promise<boolean> {
    const response = await this.sendRequestAsync({ entityId, checkSubscription: {} }, timeoutMs);
    return unwrap(response.flag, "flag").value;
  }

  async setSubscription(entityId: number, value: boolean, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ entityId, setSubscription: { value } }, timeoutMs);
  }

  async getClanInfo(timeoutMs?: number): Promise<ClanInfo | undefined> {
    const response = await this.sendRequestAsync({ getClanInfo: {} }, timeoutMs);
    return unwrap(response.clanInfo, "clanInfo").clanInfo;
  }

  async setClanMotd(message: string, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ setClanMotd: { message } }, timeoutMs);
  }

  async getClanChat(timeoutMs?: number): Promise<AppClanMessage[]> {
    const response = await this.sendRequestAsync({ getClanChat: {} }, timeoutMs);
    return unwrap(response.clanChat, "clanChat").messages;
  }

  async sendClanMessage(message: string, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ sendClanMessage: { message } }, timeoutMs);
  }

  async promoteToLeader(steamId: string | number | bigint, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ promoteToLeader: { steamId: String(steamId) } }, timeoutMs);
  }

  async getNexusAuth(appKey: string, timeoutMs?: number): Promise<AppNexusAuth> {
    const response = await this.sendRequestAsync({ getNexusAuth: { appKey } }, timeoutMs);
    return unwrap(response.nexusAuth, "nexusAuth");
  }

  /** Subscribes to a Camera at the protocol level. Prefer {@link getCamera} for a higher-level API. */
  async subscribeToCamera(identifier: string, timeoutMs?: number): Promise<AppCameraInfo> {
    const response = await this.sendRequestAsync({ cameraSubscribe: { cameraId: identifier } }, timeoutMs);
    return unwrap(response.cameraSubscribeInfo, "cameraSubscribeInfo");
  }

  async unsubscribeFromCamera(timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ cameraUnsubscribe: {} }, timeoutMs);
  }

  async sendCameraInput(buttons: number, x: number, y: number, timeoutMs?: number): Promise<void> {
    await this.sendRequestAsync({ cameraInput: { buttons, mouseDelta: { x, y } } }, timeoutMs);
  }

  /** Get a Camera instance for controlling CCTV Cameras, PTZ Cameras and Auto Turrets. */
  getCamera(identifier: string): Camera {
    return new Camera(this, identifier);
  }
}

function unwrap<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`Rust+ server response did not contain expected field '${field}'`);
  }
  return value;
}

function toError(event: Event): Error {
  if ("message" in event && typeof (event as { message?: unknown }).message === "string") {
    return new Error((event as { message: string }).message);
  }
  return new Error(`WebSocket error: ${event.type}`);
}
