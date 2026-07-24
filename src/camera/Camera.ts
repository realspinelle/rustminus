import { Jimp, JimpMime, rgbaToInt } from "jimp";
import { TypedEventEmitter } from "../util/TypedEventEmitter.js";
import { CameraButtons, CameraControlFlags } from "./CameraButtons.js";
import { buildShuffledSamplePositions, decodeFrameInto, type RaySample } from "./rayDecoder.js";
import type { AppCameraInfo, AppCameraRays, AppMessage } from "../generated/rustplus.js";
import type { RustPlus } from "../client/RustPlus.js";

export type CameraEvents = {
  subscribing: [];
  subscribed: [];
  unsubscribing: [];
  unsubscribed: [];
  render: [Buffer];
};

const RESUBSCRIBE_INTERVAL_MS = 10_000;
const FRAME_WINDOW_SIZE = 10;

const MATERIAL_COLOURS: readonly [number, number, number][] = [
  [0.5, 0.5, 0.5],
  [0.8, 0.7, 0.7],
  [0.3, 0.7, 1],
  [0.6, 0.6, 0.6],
  [0.7, 0.7, 0.7],
  [0.8, 0.6, 0.4],
  [1, 0.4, 0.4],
  [1, 0.1, 0.1],
];

function sampleToColor(sample: RaySample): [number, number, number] {
  const { distance, alignment, material } = sample;
  if (distance === 1 && alignment === 0 && material === 0) {
    return [208, 230, 252]; // sky / no hit
  }
  const [r, g, b] = MATERIAL_COLOURS[material] ?? MATERIAL_COLOURS[0]!;
  return [alignment * r * 255, alignment * g * 255, alignment * b * 255];
}

/**
 * Controls a CCTV Camera, PTZ Camera or Auto Turret. Obtained via {@link RustPlus.getCamera}.
 */
export class Camera extends TypedEventEmitter<CameraEvents> {
  readonly identifier: string;
  isSubscribed = false;

  private readonly rustplus: RustPlus;
  private cameraRays: AppCameraRays[] = [];
  private cameraSubscribeInfo: AppCameraInfo | undefined;
  private resubscribeInterval: ReturnType<typeof setInterval> | undefined;
  private samplePositions: Int16Array | undefined;

  private readonly onMessage = (message: AppMessage): void => {
    void this.handleMessage(message);
  };

  private readonly onDisconnected = (): void => {
    void this.unsubscribe();
  };

  constructor(rustplus: RustPlus, identifier: string) {
    super();
    this.rustplus = rustplus;
    this.identifier = identifier;
  }

  /** Subscribes to the camera and starts emitting `render` events as frames arrive. */
  async subscribe(): Promise<void> {
    this.emit("subscribing");

    this.rustplus.on("message", this.onMessage);
    this.rustplus.on("disconnected", this.onDisconnected);

    await this.resubscribe();

    this.emit("subscribed");

    this.resubscribeInterval = setInterval(() => {
      if (this.isSubscribed) {
        void this.resubscribe();
      }
    }, RESUBSCRIBE_INTERVAL_MS);
  }

  async unsubscribe(): Promise<void> {
    this.emit("unsubscribing");

    this.isSubscribed = false;

    if (this.resubscribeInterval) {
      clearInterval(this.resubscribeInterval);
      this.resubscribeInterval = undefined;
    }

    this.rustplus.off("message", this.onMessage);
    this.rustplus.off("disconnected", this.onDisconnected);

    this.cameraRays = [];
    this.cameraSubscribeInfo = undefined;
    this.samplePositions = undefined;

    if (this.rustplus.isConnected()) {
      try {
        await this.rustplus.unsubscribeFromCamera();
      } catch {
        // best-effort: we're already tearing down locally regardless
      }
    }

    this.emit("unsubscribed");
  }

  /** Sends camera/turret input to the server (mouse movement + buttons). */
  async move(buttons: number, x: number, y: number): Promise<void> {
    await this.rustplus.sendCameraInput(buttons, x, y);
  }

  /**
   * Zooms a PTZ camera in by 1 level. PTZ cameras have 4 zoom levels; zooming in from
   * the max level wraps back around to the minimum.
   */
  async zoom(): Promise<void> {
    await this.move(CameraButtons.FIRE_PRIMARY, 0, 0);
    await this.move(CameraButtons.NONE, 0, 0);
  }

  /** Shoots a PTZ controllable Auto Turret. */
  async shoot(): Promise<void> {
    await this.move(CameraButtons.FIRE_PRIMARY, 0, 0);
    await this.move(CameraButtons.NONE, 0, 0);
  }

  /** Reloads a PTZ controllable Auto Turret. */
  async reload(): Promise<void> {
    await this.move(CameraButtons.RELOAD, 0, 0);
    await this.move(CameraButtons.NONE, 0, 0);
  }

  isAutoTurret(): boolean {
    const flags = this.cameraSubscribeInfo?.controlFlags ?? 0;
    return (flags & CameraControlFlags.CROSSHAIR) === CameraControlFlags.CROSSHAIR;
  }

  private async resubscribe(): Promise<void> {
    const info = await this.rustplus.subscribeToCamera(this.identifier);
    this.cameraSubscribeInfo = info;
    this.isSubscribed = true;
  }

  private async handleMessage(message: AppMessage): Promise<void> {
    if (!this.isSubscribed) {
      return;
    }

    const cameraRays = message.broadcast?.cameraRays;
    if (cameraRays) {
      await this.handleCameraRays(cameraRays);
    }
  }

  private async handleCameraRays(cameraRays: AppCameraRays): Promise<void> {
    if (!this.isSubscribed || !this.cameraSubscribeInfo) {
      return;
    }

    this.cameraRays.push(cameraRays);
    if (this.cameraRays.length <= FRAME_WINDOW_SIZE) {
      return;
    }
    this.cameraRays.shift();

    const frame = await this.renderFrame(
      this.cameraRays,
      this.cameraSubscribeInfo.width,
      this.cameraSubscribeInfo.height,
    );

    if (this.isSubscribed) {
      this.emit("render", frame);
    }
  }

  private async renderFrame(frames: AppCameraRays[], width: number, height: number): Promise<Buffer> {
    this.samplePositions ??= buildShuffledSamplePositions(width, height);

    const output: (RaySample | undefined)[] = new Array(width * height);
    for (const frame of frames) {
      decodeFrameInto(frame, output, this.samplePositions, width, height);
    }

    const image = new Jimp({ width, height });
    for (let i = 0; i < output.length; i++) {
      const sample = output[i];
      if (!sample) {
        continue;
      }

      const [r, g, b] = sampleToColor(sample);
      const x = i % width;
      const y = height - 1 - Math.floor(i / width);
      image.setPixelColor(rgbaToInt(r, g, b, 255), x, y);
    }

    return image.getBuffer(JimpMime.png);
  }
}
