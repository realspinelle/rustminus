import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import AndroidFCM from "@liamcottle/push-receiver/src/android/fcm.js";
import { TypedEventEmitter } from "../util/TypedEventEmitter.js";
import { linkSteamWithRustPlus } from "./steamPairing.js";
import type { RustPlusPairingCredentials } from "./types.js";

// Constants for the Rust+ companion app's own FCM/Expo registration; these identify the
// app to Google/Expo/Facepunch and must match the real Rust+ app to be accepted.
const FCM_API_KEY = "AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY";
const FCM_PROJECT_ID = "rust-companion-app";
const FCM_GCM_SENDER_ID = "976529667804";
const FCM_GMS_APP_ID = "1:976529667804:android:d6f1ddeb4403b338fea619";
const ANDROID_PACKAGE_NAME = "com.facepunch.rust.companion";
const ANDROID_PACKAGE_CERT = "E28D05345FB78A7A1A63D70F4A302DBF426CA5AD";
const EXPO_PROJECT_ID = "49451aca-a822-41e6-ad59-955718d0ff9c";

async function getExpoPushToken(fcmToken: string): Promise<string> {
  const response = await axios.post<{ data: { expoPushToken: string } }>(
    "https://exp.host/--/api/v2/push/getExpoPushToken",
    {
      type: "fcm",
      deviceId: uuidv4(),
      development: false,
      appId: ANDROID_PACKAGE_NAME,
      deviceToken: fcmToken,
      projectId: EXPO_PROJECT_ID,
    },
  );
  return response.data.data.expoPushToken;
}

async function registerWithRustPlus(authToken: string, expoPushToken: string): Promise<void> {
  await axios.post("https://companion-rust.facepunch.com:443/api/push/register", {
    AuthToken: authToken,
    DeviceId: "rustminus",
    PushKind: 3,
    PushToken: expoPushToken,
  });
}

export type FcmRegisterEvents = {
  /** Human-readable progress narration, useful for CLI/UI feedback during the multi-step flow. */
  step: [string];
};

/**
 * Registers a new device with FCM/Expo, walks the player through logging into Steam via a
 * Chrome popup, and links the resulting Rust+ AuthToken with the Rust Companion API so that
 * Pairing notifications can be received. Emits `step` events for progress narration.
 */
export class FcmRegistration extends TypedEventEmitter<FcmRegisterEvents> {
  async run(): Promise<RustPlusPairingCredentials> {
    this.emit("step", "Registering with FCM");
    const fcmCredentials = await AndroidFCM.register(
      FCM_API_KEY,
      FCM_PROJECT_ID,
      FCM_GCM_SENDER_ID,
      FCM_GMS_APP_ID,
      ANDROID_PACKAGE_NAME,
      ANDROID_PACKAGE_CERT,
    );

    this.emit("step", "Fetching Expo Push Token");
    const expoPushToken = await getExpoPushToken(fcmCredentials.fcm.token);

    this.emit("step", "Opening Chrome so you can link your Steam account with Rust+");
    const rustplusAuthToken = await linkSteamWithRustPlus();

    this.emit("step", "Registering with the Rust Companion API");
    await registerWithRustPlus(rustplusAuthToken, expoPushToken);

    this.emit("step", "Done");
    return { fcmCredentials, expoPushToken, rustplusAuthToken };
  }
}
