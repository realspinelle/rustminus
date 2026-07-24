export interface FcmGcmCredentials {
  androidId: string;
  securityToken: string;
}

export interface FcmTokenCredentials {
  token: string;
}

/** Result of AndroidFCM.register(...) - the raw GCM/FCM registration. */
export interface FcmCredentials {
  gcm: FcmGcmCredentials;
  fcm: FcmTokenCredentials;
}

/** Everything needed to receive Rust+ pairing notifications, persisted to the config file. */
export interface RustPlusPairingCredentials {
  fcmCredentials: FcmCredentials;
  expoPushToken: string;
  rustplusAuthToken: string;
}

/** A raw data payload received from FCM. Shape is dictated by the (undocumented) GCM/MCS wire format. */
export interface FcmDataMessage {
  persistentId: string;
  appData: { key: string; value: string }[];
  [key: string]: unknown;
}
