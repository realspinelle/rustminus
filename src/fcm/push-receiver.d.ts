// @liamcottle/push-receiver ships no type declarations; these cover only the surface we use.
declare module "@liamcottle/push-receiver/src/android/fcm.js" {
  import type { FcmCredentials } from "./types.js";

  export default class AndroidFCM {
    static register(
      apiKey: string,
      projectId: string,
      gcmSenderId: string,
      gmsAppId: string,
      androidPackageName: string,
      androidPackageCert: string,
    ): Promise<FcmCredentials>;
  }
}

declare module "@liamcottle/push-receiver/src/client.js" {
  import { EventEmitter } from "node:events";

  export default class PushReceiverClient extends EventEmitter {
    constructor(androidId: string, securityToken: string, persistentIds: string[]);
    connect(): Promise<void>;
    destroy(): void;
  }
}
