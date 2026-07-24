import { promises as fs } from "node:fs";
import type { RustPlusPairingCredentials } from "./types.js";

export async function readConfig(configFile: string): Promise<Partial<RustPlusPairingCredentials>> {
  try {
    const contents = await fs.readFile(configFile, "utf8");
    return JSON.parse(contents) as Partial<RustPlusPairingCredentials>;
  } catch {
    return {};
  }
}

export async function writeConfig(
  configFile: string,
  update: Partial<RustPlusPairingCredentials>,
): Promise<void> {
  const current = await readConfig(configFile);
  const merged = { ...current, ...update };
  await fs.writeFile(configFile, JSON.stringify(merged, null, 2), "utf8");
}
