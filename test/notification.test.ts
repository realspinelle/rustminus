import { describe, expect, test } from "bun:test";
import {
  classifyNotification,
  pairingToRustPlusOptions,
  parseEntityType,
  parseNotification,
} from "../src/fcm/notification.js";
import { AppEntityType } from "../src/generated/rustplus.js";
import type { FcmDataMessage } from "../src/fcm/types.js";

function makeDataMessage(fields: Record<string, string>): FcmDataMessage {
  return {
    persistentId: "test-persistent-id",
    appData: Object.entries(fields).map(([key, value]) => ({ key, value })),
  };
}

describe("parseNotification", () => {
  // Field set/shape confirmed against a real "pair with server" notification from a live server.
  test("parses a server pairing notification", () => {
    const data = makeDataMessage({
      title: "My Rust Server",
      message: "Tap to pair with this server.",
      channelId: "pairing",
      body: JSON.stringify({
        id: "add465e5-85cc-4ac2-9858-f0d7926e3d13",
        name: "My Rust Server",
        desc: "A cool server",
        img: "https://example.invalid/img.png",
        logo: "",
        url: "https://example.invalid",
        ip: "12.34.56.78",
        port: "28082",
        playerId: "76561198000000123",
        playerToken: "987654321", // sent as a numeric string, not a JSON number
        type: "server",
      }),
    });

    const parsed = parseNotification(data);
    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe("My Rust Server");
    expect(parsed?.channelId).toBe("pairing");
    expect(parsed?.body.ip).toBe("12.34.56.78");
    expect(parsed?.body.playerToken).toBe("987654321");
    expect(classifyNotification(parsed!)).toBe("pairing-server");
  });

  // entityId/entityType shape confirmed against real "pair with device" notifications for all
  // three device kinds (Smart Switch, Smart Alarm, Storage Monitor) from a live server.
  test.each([
    ["Smart Switch", "16183266", "1", AppEntityType.Switch],
    ["Smart Alarm", "16183263", "2", AppEntityType.Alarm],
    ["Storage Monitor", "16183248", "3", AppEntityType.StorageMonitor],
  ] as const)("parses an entity pairing notification for %s", (entityName, entityId, entityType, expectedType) => {
    const data = makeDataMessage({
      title: entityName,
      message: "Tap to pair with this device.",
      channelId: "pairing",
      body: JSON.stringify({
        ip: "12.34.56.78",
        port: "28082",
        playerId: "76561198000000123",
        playerToken: "987654321",
        entityId,
        entityType,
        entityName,
        name: "My Rust Server",
        type: "entity",
      }),
    });

    const parsed = parseNotification(data);
    expect(classifyNotification(parsed!)).toBe("pairing-entity");
    expect(parsed?.body.entityId).toBe(entityId);
    expect(parseEntityType(parsed!.body)).toBe(expectedType);
  });

  test("parseEntityType returns undefined for an unrecognized value", () => {
    expect(parseEntityType({ entityType: "99" })).toBeUndefined();
    expect(parseEntityType({})).toBeUndefined();
  });

  test("returns undefined when appData is missing", () => {
    expect(parseNotification({ persistentId: "x" } as FcmDataMessage)).toBeUndefined();
  });

  test("returns undefined when body is not valid JSON", () => {
    const data = makeDataMessage({
      title: "t",
      message: "m",
      channelId: "pairing",
      body: "not json",
    });
    expect(parseNotification(data)).toBeUndefined();
  });

  // Confirmed live: an "under attack" alarm notification has NO playerId/playerToken/entityId -
  // Facepunch's own client can't tell you which alarm fired from this notification alone, only
  // that a base was attacked. pairingToRustPlusOptions must fail closed (return undefined) here.
  test("parses an alarm notification, which lacks player auth and entity fields", () => {
    const data = makeDataMessage({
      title: "Alarm",
      message: "Your base is under attack!",
      channelId: "alarm",
      body: JSON.stringify({
        id: "add465e5-85cc-4ac2-9858-f0d7926e3d13",
        name: "My Rust Server",
        desc: "A cool server",
        img: "https://example.invalid/img.png",
        logo: "",
        url: "https://example.invalid",
        ip: "12.34.56.78",
        port: "28082",
        type: "alarm",
      }),
    });

    const parsed = parseNotification(data);
    expect(classifyNotification(parsed!)).toBe("alarm");
    expect(parsed?.body.playerId).toBeUndefined();
    expect(parsed?.body.entityId).toBeUndefined();
    expect(pairingToRustPlusOptions(parsed!.body)).toBeUndefined();
  });

  // Confirmed live: a real "You were killed by X" push. Also lacks playerId/playerToken/entityId
  // - only targetId/targetName identify the killer.
  test("parses a player-death notification", () => {
    const data = makeDataMessage({
      title: "You were killed by Watcher 1",
      message: "My Rust Server",
      channelId: "player",
      body: JSON.stringify({
        id: "add465e5-85cc-4ac2-9858-f0d7926e3d13",
        name: "My Rust Server",
        desc: "A cool server",
        img: "https://example.invalid/img.png",
        logo: "",
        url: "https://example.invalid",
        ip: "12.34.56.78",
        port: "28082",
        type: "death",
        targetId: "76561198000000456",
        targetName: "Watcher 1",
      }),
    });

    const parsed = parseNotification(data);
    expect(classifyNotification(parsed!)).toBe("player-death");
    expect(parsed?.body.targetId).toBe("76561198000000456");
    expect(parsed?.body.targetName).toBe("Watcher 1");
    expect(pairingToRustPlusOptions(parsed!.body)).toBeUndefined();
  });

  test("classifies unrecognized channel/type combinations as unknown", () => {
    const data = makeDataMessage({
      title: "t",
      message: "m",
      channelId: "news",
      body: JSON.stringify({ type: "news" }),
    });
    const parsed = parseNotification(data);
    expect(classifyNotification(parsed!)).toBe("unknown");
  });
});

describe("pairingToRustPlusOptions", () => {
  test("builds RustPlusOptions from a server pairing body", () => {
    const options = pairingToRustPlusOptions({
      ip: "12.34.56.78",
      port: "28082",
      playerId: "76561198000000123",
      playerToken: "987654321",
    });

    expect(options).toEqual({
      server: "12.34.56.78",
      port: 28082,
      playerId: "76561198000000123",
      playerToken: 987654321,
    });
  });

  test("also works with an entity pairing body, since it shares the same connection fields", () => {
    const options = pairingToRustPlusOptions({
      ip: "12.34.56.78",
      port: "28082",
      playerId: "76561198000000123",
      playerToken: "987654321",
      entityId: "16183266",
      entityType: "1",
      type: "entity",
    });

    expect(options).toEqual({
      server: "12.34.56.78",
      port: 28082,
      playerId: "76561198000000123",
      playerToken: 987654321,
    });
  });

  test("returns undefined when required fields are missing", () => {
    expect(pairingToRustPlusOptions({ ip: "12.34.56.78" })).toBeUndefined();
  });
});
