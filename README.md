# rustminus

A TypeScript rewrite of [rustplus.js](https://github.com/liamcottle/rustplus.js) — an event-based
client for the [Rust+](https://rust.facepunch.com/companion) companion API.

- **Event-based**: connection lifecycle, incoming broadcasts, and camera frames are all delivered
  through a strongly-typed `EventEmitter`-style API.
- **Promise-based information retrieval**: every request/response call (`getInfo`, `getMap`,
  `getTeamInfo`, `getEntityInfo`, ...) returns a `Promise` resolved with the typed payload, not the
  raw envelope.
- **Statically typed protobuf**: `rustplus.proto` is compiled ahead of time with
  [ts-proto](https://github.com/stephenh/ts-proto), so message shapes are real TypeScript
  interfaces, not `any`.
- Steam64 ids (`playerId`, `steamId`, `clanId`, ...) are represented as `string`, since they exceed
  `Number.MAX_SAFE_INTEGER`.

Requires [Bun](https://bun.sh) (or Node.js >= 22, which ships a native `WebSocket` global).

> Built with [Claude Code](https://claude.com/claude-code), with the FCM/WebSocket protocol
> behavior verified live against a real Rust server along the way.

## Install

```sh
bun add rustminus
```

## Quickstart

```ts
import { RustPlus } from "rustminus";

const rustplus = new RustPlus({
  server: "12.34.56.78",
  port: 28082,
  playerId: "76561198000000000",
  playerToken: 1234567890,
});

rustplus.on("message", (message) => {
  if (message.broadcast?.teamMessage) {
    console.log(message.broadcast.teamMessage.message.message);
  }
});

await rustplus.connect();

const info = await rustplus.getInfo();
console.log(`${info.name}: ${info.players}/${info.maxPlayers} players`);

await rustplus.sendTeamMessage("Hello from rustminus!");
```

## Team tracking

The server's `teamChanged` broadcast is not reliable on its own — confirmed live against a real
server, a death with a fast respawn produced no broadcast at all (it only surfaced later, bundled
into a broadcast that fired for an unrelated membership change). Pass `trackTeam: true` to also
poll `getTeamInfo()` on an interval (`teamPollIntervalMs`, default 5000ms) and diff snapshots:

```ts
const rustplus = new RustPlus({ ...options, trackTeam: true });

rustplus.on("teamChanged", (teamInfo, changes) => {
  for (const change of changes) {
    if (change.type === "memberDied") console.log(`${change.member.name} died`);
  }
});
```

Real `teamChanged` broadcasts always emit (they're reliable for joins/leaves). Polling only emits
when the diff contains a death, respawn, or online/offline change - all confirmed live to *not*
reliably fire their own broadcast - to avoid firing on every minor position update otherwise.

## Camera

```ts
const camera = rustplus.getCamera("OILRIG1");

camera.on("render", (png) => {
  // png is a Buffer containing a rendered PNG frame
});

await camera.subscribe();
await camera.zoom(); // PTZ cameras / auto turrets only
```

## Pairing (FCM)

Rust+ delivers pairing notifications over Firebase Cloud Messaging. `rustminus` ships a CLI to
register a device and listen for them:

```sh
bunx rustminus fcm-register   # opens Chrome to link your Steam account, saves credentials
bunx rustminus fcm-listen     # prints incoming pairing notifications
```

Both commands accept `--config-file <path>` (defaults to `./rustminus.config.json`).

> **Gotcha, confirmed live:** Facepunch's push registration appears to be one destination per
> Steam account, not real multi-device fan-out. If the real Rust+ mobile app opens (or refreshes
> its own registration) *after* you run `fcm-register`, it silently reclaims the notifications -
> your `fcm-listen` process stays connected (no error, no disconnect) but simply stops receiving
> anything new. Re-running `fcm-register` reclaims it back. Don't open the phone app if you need
> `rustminus` to keep receiving pushes.

The same flow is available programmatically via `FcmRegistration` and `FcmListener`, both of which
are event emitters (`step` / `connected` / `disconnected` / `notification`). `FcmListener` also
parses the raw FCM payload into a typed `RustPlusNotification` and emits it as `rustplusNotification`
whenever it recognizes the shape: `pairing-server`, `pairing-entity`, `alarm`, and `player-death`
are all confirmed against real payloads; `team-login` is ported from `rustplusplus`'s handling but
never actually observed firing (even during real login/logout activity), so treat it as best-effort.

```ts
import { FcmListener, classifyNotification, pairingToRustPlusOptions, parseEntityType, RustPlus } from "rustminus";

const listener = new FcmListener(credentials);

listener.on("rustplusNotification", (notification) => {
  const kind = classifyNotification(notification);

  if (kind === "pairing-server" || kind === "pairing-entity") {
    const options = pairingToRustPlusOptions(notification.body);
    if (options) {
      const rustplus = new RustPlus(options);
      // connect and start using it immediately
    }
  }

  if (kind === "pairing-entity") {
    console.log(notification.body.entityId, parseEntityType(notification.body));
  }
});

await listener.connect();
```

This parsed shape is reverse engineered (Facepunch documents none of it) and every field on
`body` is optional as a result — treat it defensively.

## Development

```sh
bun install
bun run generate:proto   # regenerate src/generated/rustplus.ts from proto/rustplus.proto
bun test
bun run typecheck
bun run build
```

## Project layout

```
proto/rustplus.proto     Protocol schema, copied from rustplus.js
src/generated/            ts-proto output (generated, checked in)
src/client/                RustPlus client
src/camera/                Camera + CCTV ray-frame decoder/renderer
src/fcm/                   FCM device registration, pairing flow, notification listener
src/cli/                   `rustminus` CLI (commander)
src/util/                  TypedEventEmitter
```
