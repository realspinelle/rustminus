#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { readConfig, writeConfig } from "../fcm/config.js";
import { FcmRegistration } from "../fcm/fcmRegister.js";
import { FcmListener } from "../fcm/FcmListener.js";
import { closeSteamPairingBrowser } from "../fcm/steamPairing.js";

const program = new Command();

program
  .name("rustminus")
  .description("Command line tool for things related to Rust+")
  .option("--config-file <file>", "Path to config file", path.join(process.cwd(), "rustminus.config.json"));

program
  .command("fcm-register")
  .description(
    "Registers with FCM, Expo and links your Steam account with Rust+ so you can listen for Pairing notifications.",
  )
  .action(async () => {
    const { configFile } = program.opts<{ configFile: string }>();

    const registration = new FcmRegistration();
    registration.on("step", (message) => console.log(message));

    const credentials = await registration.run();
    await writeConfig(configFile, credentials);

    console.log(`FCM, Expo and Rust+ auth tokens have been saved to ${configFile}`);
  });

program
  .command("fcm-listen")
  .description("Listens for notifications received from FCM, such as Rust+ Pairing notifications.")
  .action(async () => {
    const { configFile } = program.opts<{ configFile: string }>();
    const config = await readConfig(configFile);

    if (!config.fcmCredentials) {
      console.error("FCM credentials missing. Please run `rustminus fcm-register` first.");
      process.exitCode = 1;
      return;
    }

    const listener = new FcmListener(config.fcmCredentials);
    listener.on("connected", () => console.log("Listening for FCM notifications"));
    listener.on("disconnected", () => console.log("Disconnected from FCM"));
    listener.on("notification", (data) => {
      const timestamp = new Date().toLocaleString();
      console.log(`\x1b[32m[${timestamp}] Notification Received\x1b[0m`);
      console.log(data);
    });

    process.on("SIGINT", () => {
      listener.disconnect();
      process.exit(0);
    });

    await listener.connect();
  });

async function shutdown(): Promise<void> {
  await closeSteamPairingBrowser();
}

process.on("SIGTERM", () => void shutdown());

await program.parseAsync();
