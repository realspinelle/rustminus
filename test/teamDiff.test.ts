import { describe, expect, test } from "bun:test";
import { diffTeamInfo } from "../src/client/teamDiff.js";
import type { AppTeamInfo, AppTeamInfo_Member } from "../src/generated/rustplus.js";

function makeMember(overrides: Partial<AppTeamInfo_Member> = {}): AppTeamInfo_Member {
  return {
    steamId: "76561198000000001",
    name: "random farmer",
    x: 100,
    y: 200,
    isOnline: true,
    spawnTime: 1000,
    isAlive: true,
    deathTime: 0,
    ...overrides,
  };
}

function makeTeamInfo(members: AppTeamInfo_Member[], leaderSteamId = "0"): AppTeamInfo {
  return { leaderSteamId, members, mapNotes: [], leaderMapNotes: [] };
}

describe("diffTeamInfo", () => {
  test("returns no events when there is no previous snapshot", () => {
    expect(diffTeamInfo(undefined, makeTeamInfo([makeMember()]))).toEqual([]);
  });

  test("detects a new member joining", () => {
    const previous = makeTeamInfo([makeMember({ steamId: "1" })]);
    const current = makeTeamInfo([makeMember({ steamId: "1" }), makeMember({ steamId: "2" })]);

    expect(diffTeamInfo(previous, current)).toEqual([{ type: "memberJoined", member: makeMember({ steamId: "2" }) }]);
  });

  test("detects a member leaving", () => {
    const previous = makeTeamInfo([makeMember({ steamId: "1" }), makeMember({ steamId: "2" })]);
    const current = makeTeamInfo([makeMember({ steamId: "1" })]);

    expect(diffTeamInfo(previous, current)).toEqual([{ type: "memberLeft", member: makeMember({ steamId: "2" }) }]);
  });

  test("detects a leader change", () => {
    const previous = makeTeamInfo([makeMember()], "0");
    const current = makeTeamInfo([makeMember()], "76561198000000001");

    expect(diffTeamInfo(previous, current)).toEqual([
      { type: "leaderChanged", leaderSteamId: "76561198000000001" },
    ]);
  });

  // Confirmed live: a fast respawn can mean isAlive is true in both snapshots, with only
  // deathTime changing - this must still be detected as a death.
  test("detects death via deathTime change even when isAlive stays true (fast respawn)", () => {
    const previous = makeTeamInfo([makeMember({ isAlive: true, deathTime: 0 })]);
    const current = makeTeamInfo([makeMember({ isAlive: true, deathTime: 555 })]);

    expect(diffTeamInfo(previous, current)).toEqual([
      { type: "memberDied", member: makeMember({ isAlive: true, deathTime: 555 }) },
    ]);
  });

  // Confirmed live: reconnecting after a death reset deathTime back to 0 while isAlive stayed
  // true and isOnline flipped true - this must NOT be reported as a death.
  test("does not report a death when deathTime resets back to 0 on reconnect", () => {
    const previous = makeTeamInfo([makeMember({ isOnline: false, isAlive: true, deathTime: 555 })]);
    const current = makeTeamInfo([makeMember({ isOnline: true, isAlive: true, deathTime: 0 })]);

    expect(diffTeamInfo(previous, current)).toEqual([
      { type: "memberWentOnline", member: makeMember({ isOnline: true, isAlive: true, deathTime: 0 }) },
    ]);
  });

  test("detects death via an isAlive true->false transition", () => {
    const previous = makeTeamInfo([makeMember({ isAlive: true, deathTime: 0 })]);
    const current = makeTeamInfo([makeMember({ isAlive: false, deathTime: 555 })]);

    expect(diffTeamInfo(previous, current)).toEqual([
      { type: "memberDied", member: makeMember({ isAlive: false, deathTime: 555 }) },
    ]);
  });

  test("detects a respawn (isAlive false->true)", () => {
    const previous = makeTeamInfo([makeMember({ isAlive: false, deathTime: 555 })]);
    const current = makeTeamInfo([makeMember({ isAlive: true, deathTime: 555 })]);

    expect(diffTeamInfo(previous, current)).toEqual([
      { type: "memberRespawned", member: makeMember({ isAlive: true, deathTime: 555 }) },
    ]);
  });

  test("detects going online and offline", () => {
    const online = makeTeamInfo([makeMember({ isOnline: true })]);
    const offline = makeTeamInfo([makeMember({ isOnline: false })]);

    expect(diffTeamInfo(offline, online)).toEqual([
      { type: "memberWentOnline", member: makeMember({ isOnline: true }) },
    ]);
    expect(diffTeamInfo(online, offline)).toEqual([
      { type: "memberWentOffline", member: makeMember({ isOnline: false }) },
    ]);
  });

  test("movement alone is not reported as a change", () => {
    const previous = makeTeamInfo([makeMember({ x: 100, y: 200 })]);
    const current = makeTeamInfo([makeMember({ x: 101, y: 200 })]);

    expect(diffTeamInfo(previous, current)).toEqual([]);
  });

  test("returns no events when nothing changed", () => {
    const teamInfo = makeTeamInfo([makeMember()]);
    expect(diffTeamInfo(teamInfo, teamInfo)).toEqual([]);
  });
});
