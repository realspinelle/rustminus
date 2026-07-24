import express from "express";
import * as ChromeLauncher from "chrome-launcher";
import path from "node:path";
import os from "node:os";
import type { Server } from "node:http";

const PAIR_SERVER_PORT = 3000; // must match the callback URL hardcoded in pair.html

/**
 * Opens a Chrome window to the Rust+ Steam login flow and resolves with the resulting
 * Rust+ AuthToken once the player has logged in.
 *
 * Chrome is launched with web security disabled so we can inject a `ReactNativeWebView`
 * shim into the Rust+ login page - the page normally only talks to the real Rust+ mobile
 * app, so this is how we capture the auth token it posts back after a successful login.
 */
export async function linkSteamWithRustPlus(): Promise<string> {
  const app = express();

  app.get("/", (_req, res) => {
    res.sendFile(path.join(import.meta.dirname, "pair.html"));
  });

  return new Promise<string>((resolve, reject) => {
    let server: Server | undefined;

    app.get("/callback", async (req, res) => {
      await ChromeLauncher.killAll();

      const authToken = req.query["token"];
      if (typeof authToken === "string" && authToken.length > 0) {
        res.send("Steam Account successfully linked with rustminus, you can now close this window.");
        resolve(authToken);
      } else {
        res.status(400).send("Token missing from request!");
        reject(new Error("Token missing from Rust+ login callback"));
      }

      server?.close();
    });

    server = app.listen(PAIR_SERVER_PORT, () => {
      ChromeLauncher.launch({
        startingUrl: `http://localhost:${PAIR_SERVER_PORT}`,
        chromeFlags: [
          "--disable-web-security", // lets us manipulate the Rust+ login page's window object
          "--disable-popup-blocking", // lets us open the Rust+ login popup from our own page
          "--disable-site-isolation-trials", // required for --disable-web-security to work
          `--user-data-dir=${path.join(os.tmpdir(), "rustminus-chrome-profile")}`,
        ],
        handleSIGINT: false, // shutdown is handled by the caller
      }).catch((error: unknown) => {
        reject(new Error(`Failed to launch Google Chrome. Is it installed? (${String(error)})`));
      });
    });
  });
}

/** Kills any Chrome instance launched by {@link linkSteamWithRustPlus}. */
export async function closeSteamPairingBrowser(): Promise<void> {
  await ChromeLauncher.killAll();
}
