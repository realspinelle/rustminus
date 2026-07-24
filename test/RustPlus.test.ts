import { describe, expect, test } from "bun:test";
import { RustPlus } from "../src/client/RustPlus.js";
import { AppMessage, AppRequest, type AppResponse, type AppTeamInfo_Member } from "../src/generated/rustplus.js";
import type { RustPlusOptions } from "../src/client/types.js";

type Listener = (event: { data?: ArrayBuffer }) => void;

/** A minimal in-memory stand-in for the WebSocket interface RustPlus depends on. */
class FakeSocket {
  binaryType = "";
  readyState = 0; // CONNECTING
  onSend: ((data: Uint8Array) => void) | undefined;

  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  send(data: Uint8Array): void {
    this.onSend?.(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.dispatch("close", {});
  }

  open(): void {
    this.readyState = 1; // OPEN
    this.dispatch("open", {});
  }

  receive(data: Uint8Array): void {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    this.dispatch("message", { data: buffer });
  }

  private dispatch(type: string, event: { data?: ArrayBuffer }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createClient(
  onSend?: (socket: FakeSocket, request: AppRequest) => void,
  overrides: Partial<RustPlusOptions> = {},
) {
  const socket = new FakeSocket();
  socket.onSend = (data) => onSend?.(socket, AppRequest.decode(data));

  const rustplus = new RustPlus({
    server: "example.invalid",
    port: 28015,
    // 17-digit Steam64 id - exceeds Number.MAX_SAFE_INTEGER, exercising the string playerId path.
    playerId: "76561198000000123",
    playerToken: 123456,
    createWebSocket: () => socket as unknown as WebSocket,
    ...overrides,
  });

  return { rustplus, socket };
}

function respondWith(socket: FakeSocket, seq: number, response: Partial<AppResponse>): void {
  queueMicrotask(() => {
    socket.receive(AppMessage.encode({ response: { seq, ...response } }).finish());
  });
}

describe("RustPlus", () => {
  test("connect() resolves once the socket opens", async () => {
    const { rustplus, socket } = createClient();
    const connecting = rustplus.connect();
    socket.open();
    await connecting;
    expect(rustplus.isConnected()).toBe(true);
  });

  test("playerId round-trips a Steam64 id beyond Number.MAX_SAFE_INTEGER", async () => {
    const { rustplus, socket } = createClient((_socket, request) => {
      expect(request.playerId).toBe("76561198000000123");
      respondWith(_socket, request.seq, { success: {} });
    });
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    await rustplus.sendRequestAsync({ getInfo: {} });
  });

  test("getInfo() resolves with the typed AppInfo payload", async () => {
    const { rustplus, socket } = createClient((_socket, request) => {
      respondWith(_socket, request.seq, {
        info: {
          name: "Test Server",
          headerImage: "",
          url: "",
          map: "Procedural Map",
          mapSize: 3000,
          wipeTime: 0,
          players: 5,
          maxPlayers: 100,
          queuedPlayers: 0,
        },
      });
    });
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    const info = await rustplus.getInfo();
    expect(info.name).toBe("Test Server");
    expect(info.mapSize).toBe(3000);
  });

  test("a server AppError rejects the promise with its message", async () => {
    const { rustplus, socket } = createClient((_socket, request) => {
      respondWith(_socket, request.seq, { error: { error: "no permission" } });
    });
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    await expect(rustplus.getInfo()).rejects.toThrow("no permission");
  });

  test("sendRequestAsync rejects on timeout when the server never responds", async () => {
    const { rustplus, socket } = createClient(); // never responds
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    await expect(rustplus.sendRequestAsync({ getInfo: {} }, 20)).rejects.toThrow(/Timeout/);
  });

  test("turnSmartSwitchOn sends setEntityValue(true) for the given entity", async () => {
    const { rustplus, socket } = createClient((_socket, request) => {
      expect(request.entityId).toBe(42);
      expect(request.setEntityValue?.value).toBe(true);
      respondWith(_socket, request.seq, { success: {} });
    });
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    await rustplus.turnSmartSwitchOn(42);
  });

  test("trackTeam: polling only emits teamChanged when a death or respawn is detected", async () => {
    const baseMember: AppTeamInfo_Member = {
      steamId: "1",
      name: "p",
      x: 0,
      y: 0,
      isOnline: true,
      spawnTime: 100,
      isAlive: true,
      deathTime: 0,
    };
    const movedMember = { ...baseMember, x: 10 };
    const diedMember = { ...movedMember, isAlive: false, deathTime: 999 };
    const snapshots = [
      { leaderSteamId: "0", members: [baseMember], mapNotes: [], leaderMapNotes: [] },
      { leaderSteamId: "0", members: [movedMember], mapNotes: [], leaderMapNotes: [] },
      { leaderSteamId: "0", members: [diedMember], mapNotes: [], leaderMapNotes: [] },
    ];
    let pollCount = 0;

    const { rustplus, socket } = createClient(
      (_socket, request) => {
        if (request.getTeamInfo) {
          const teamInfo = snapshots[Math.min(pollCount, snapshots.length - 1)];
          pollCount++;
          respondWith(_socket, request.seq, { teamInfo });
        }
      },
      { trackTeam: true, teamPollIntervalMs: 20 },
    );

    const emissions: unknown[] = [];
    rustplus.on("teamChanged", (_teamInfo, changes) => emissions.push(changes));

    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    // Poll 1 (immediate, seeds baseline) -> Poll 2 (moved only, must NOT emit) -> Poll 3 (died, must emit).
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(emissions).toEqual([[{ type: "memberDied", member: diedMember }]]);
  });

  // Confirmed live: disconnecting from the game did not produce a teamChanged broadcast either -
  // same category of "existing member's status changed" as death/respawn, so polling must catch it.
  test("trackTeam: polling emits teamChanged when a member goes offline", async () => {
    const onlineMember: AppTeamInfo_Member = {
      steamId: "1",
      name: "p",
      x: 0,
      y: 0,
      isOnline: true,
      spawnTime: 100,
      isAlive: true,
      deathTime: 0,
    };
    const offlineMember = { ...onlineMember, isOnline: false };
    const snapshots = [
      { leaderSteamId: "0", members: [onlineMember], mapNotes: [], leaderMapNotes: [] },
      { leaderSteamId: "0", members: [offlineMember], mapNotes: [], leaderMapNotes: [] },
    ];
    let pollCount = 0;

    const { rustplus, socket } = createClient(
      (_socket, request) => {
        if (request.getTeamInfo) {
          const teamInfo = snapshots[Math.min(pollCount, snapshots.length - 1)];
          pollCount++;
          respondWith(_socket, request.seq, { teamInfo });
        }
      },
      { trackTeam: true, teamPollIntervalMs: 20 },
    );

    const emissions: unknown[] = [];
    rustplus.on("teamChanged", (_teamInfo, changes) => emissions.push(changes));

    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(emissions).toEqual([[{ type: "memberWentOffline", member: offlineMember }]]);
  });

  test("trackTeam: a teamChanged broadcast emits even when the diff is empty (e.g. movement alone, which isn't tracked)", async () => {
    const before: AppTeamInfo_Member = {
      steamId: "1",
      name: "p",
      x: 0,
      y: 0,
      isOnline: true,
      spawnTime: 100,
      isAlive: true,
      deathTime: 0,
    };
    const after = { ...before, x: 10 };

    const { rustplus, socket } = createClient(
      (_socket, request) => {
        if (request.getTeamInfo) {
          // long poll interval means this only ever answers the immediate startup poll
          respondWith(_socket, request.seq, {
            teamInfo: { leaderSteamId: "0", members: [before], mapNotes: [], leaderMapNotes: [] },
          });
        }
      },
      { trackTeam: true, teamPollIntervalMs: 60_000 },
    );

    const emissions: unknown[] = [];
    rustplus.on("teamChanged", (_teamInfo, changes) => emissions.push(changes));

    const connecting = rustplus.connect();
    socket.open();
    await connecting;
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the immediate startup poll land first

    socket.receive(
      AppMessage.encode({
        broadcast: {
          teamChanged: {
            playerId: "1",
            teamInfo: { leaderSteamId: "0", members: [after], mapNotes: [], leaderMapNotes: [] },
          },
        },
      }).finish(),
    );

    expect(emissions).toEqual([[]]);
  });

  test("teamMessage fires with the decoded AppTeamMessage on a team chat broadcast", async () => {
    const { rustplus, socket } = createClient();
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    const received: unknown[] = [];
    rustplus.on("teamMessage", (message) => received.push(message));

    socket.receive(
      AppMessage.encode({
        broadcast: {
          teamMessage: {
            message: { steamId: "1", name: "random farmer", message: "hello", color: "#5af", time: 123 },
          },
        },
      }).finish(),
    );

    expect(received).toEqual([{ steamId: "1", name: "random farmer", message: "hello", color: "#5af", time: 123 }]);
  });

  test("entityChanged fires with entityId and the decoded payload on an entity broadcast", async () => {
    const { rustplus, socket } = createClient();
    const connecting = rustplus.connect();
    socket.open();
    await connecting;

    const received: unknown[] = [];
    rustplus.on("entityChanged", (entityId, payload) => received.push({ entityId, payload }));

    socket.receive(
      AppMessage.encode({
        broadcast: {
          entityChanged: {
            entityId: 42,
            payload: { value: true, items: [], capacity: 0, hasProtection: false, protectionExpiry: 0 },
          },
        },
      }).finish(),
    );

    expect(received).toEqual([
      { entityId: 42, payload: { value: true, items: [], capacity: 0, hasProtection: false, protectionExpiry: 0 } },
    ]);
  });
});
