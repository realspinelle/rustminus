import PushReceiverClient from "@liamcottle/push-receiver/src/client.js";
import { TypedEventEmitter } from "../util/TypedEventEmitter.js";
import { parseNotification, type RustPlusNotification } from "./notification.js";
import type { FcmCredentials, FcmDataMessage } from "./types.js";

export type FcmListenerEvents = {
  connected: [];
  disconnected: [];
  /** The raw FCM data message, whatever it contains. */
  notification: [FcmDataMessage];
  /** Emitted alongside `notification` whenever it parses as a Rust+ notification. */
  rustplusNotification: [RustPlusNotification];
};

/**
 * Listens for FCM push notifications (such as Rust+ Pairing notifications) using
 * previously registered {@link FcmCredentials}.
 */
export class FcmListener extends TypedEventEmitter<FcmListenerEvents> {
  private client: PushReceiverClient | undefined;

  constructor(private readonly credentials: FcmCredentials) {
    super();
  }

  async connect(): Promise<void> {
    const client = new PushReceiverClient(this.credentials.gcm.androidId, this.credentials.gcm.securityToken, []);
    this.client = client;

    client.on("connect", () => this.emit("connected"));
    client.on("disconnect", () => this.emit("disconnected"));
    client.on("ON_DATA_RECEIVED", (data: FcmDataMessage) => {
      this.emit("notification", data);

      const parsed = parseNotification(data);
      if (parsed) {
        this.emit("rustplusNotification", parsed);
      }
    });

    await client.connect();
  }

  disconnect(): void {
    this.client?.destroy();
    this.client = undefined;
  }
}
