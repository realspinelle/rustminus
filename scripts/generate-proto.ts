import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const binExt = process.platform === "win32" ? ".exe" : "";
const pluginPath = path.join(root, "node_modules", ".bin", `protoc-gen-ts_proto${binExt}`);
const protocPath = path.join(root, "node_modules", ".bin", `protoc${binExt}`);

if (!existsSync(pluginPath)) {
  throw new Error(`ts-proto plugin not found at ${pluginPath}. Did "bun install" run?`);
}
if (!existsSync(protocPath)) {
  throw new Error(`protoc binary not found at ${protocPath}. Did "bun install" run?`);
}

const result = spawnSync(
  protocPath,
  [
    `--plugin=protoc-gen-ts_proto=${pluginPath}`,
    `--ts_proto_out=${path.join(root, "src", "generated")}`,
    "--ts_proto_opt=esModuleInterop=true,outputEncodeMethods=true,outputJsonMethods=false,outputClientImpl=false,useOptionals=messages,unrecognizedEnum=false,forceLong=string",
    `--proto_path=${path.join(root, "proto")}`,
    path.join(root, "proto", "rustplus.proto"),
  ],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
