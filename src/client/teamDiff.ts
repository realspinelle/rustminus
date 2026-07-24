import type { AppTeamInfo, AppTeamInfo_Member } from "../generated/rustplus.js";

export type TeamDiffEvent =
  | { type: "leaderChanged"; leaderSteamId: string }
  | { type: "memberJoined"; member: AppTeamInfo_Member }
  | { type: "memberLeft"; member: AppTeamInfo_Member }
  | { type: "memberDied"; member: AppTeamInfo_Member }
  | { type: "memberRespawned"; member: AppTeamInfo_Member }
  | { type: "memberWentOnline"; member: AppTeamInfo_Member }
  | { type: "memberWentOffline"; member: AppTeamInfo_Member };

/**
 * Diffs two AppTeamInfo snapshots into a list of higher-level events.
 *
 * Confirmed live against a real server: the `teamChanged` broadcast does NOT reliably fire on
 * every member stat change (a death with a fast respawn produced no broadcast of its own - it
 * only surfaced later, bundled into a broadcast that fired for an unrelated membership change).
 * So this is meant to be fed both `teamChanged` broadcasts *and* polled `getTeamInfo()` snapshots
 * - polling is what guarantees a change is eventually caught, matching how rustplusplus itself
 * relies on a polling loop rather than broadcasts alone.
 *
 * `died` intentionally checks `deathTime` changing, not just an isAlive true->false transition,
 * since a fast respawn can mean isAlive is `true` in both the before and after snapshot. But it
 * requires the *new* deathTime to be nonzero - confirmed live that deathTime can reset back to 0
 * on reconnect (alongside isOnline flipping true), which is a death record being cleared, not a
 * new death, and must not be reported as one.
 *
 * Position (x/y) is deliberately not diffed into its own event: it changes near-continuously
 * while a member is active, so treating it as a notable "change" would defeat the point of this
 * diff. If you need live positions, call getTeamInfo() directly on your own schedule.
 */
export function diffTeamInfo(previous: AppTeamInfo | undefined, current: AppTeamInfo): TeamDiffEvent[] {
  const events: TeamDiffEvent[] = [];

  if (!previous) {
    return events; // first snapshot just seeds state, nothing to diff against yet
  }

  if (previous.leaderSteamId !== current.leaderSteamId) {
    events.push({ type: "leaderChanged", leaderSteamId: current.leaderSteamId });
  }

  const previousMembers = new Map(previous.members.map((member) => [member.steamId, member]));
  const currentMembers = new Map(current.members.map((member) => [member.steamId, member]));

  for (const [steamId, member] of currentMembers) {
    const before = previousMembers.get(steamId);
    if (!before) {
      events.push({ type: "memberJoined", member });
      continue;
    }

    if ((before.isAlive && !member.isAlive) || (member.deathTime !== 0 && before.deathTime !== member.deathTime)) {
      events.push({ type: "memberDied", member });
    }
    if (!before.isAlive && member.isAlive) {
      events.push({ type: "memberRespawned", member });
    }

    if (!before.isOnline && member.isOnline) {
      events.push({ type: "memberWentOnline", member });
    } else if (before.isOnline && !member.isOnline) {
      events.push({ type: "memberWentOffline", member });
    }
  }

  for (const [steamId, member] of previousMembers) {
    if (!currentMembers.has(steamId)) {
      events.push({ type: "memberLeft", member });
    }
  }

  return events;
}
