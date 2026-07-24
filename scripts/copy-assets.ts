import { cpSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

cpSync(path.join(root, "src", "fcm", "pair.html"), path.join(root, "dist", "fcm", "pair.html"));
