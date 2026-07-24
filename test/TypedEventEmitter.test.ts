import { describe, expect, test } from "bun:test";
import { TypedEventEmitter, type EventMap } from "../src/util/TypedEventEmitter.js";

type Events = EventMap & {
  greet: [name: string];
  ping: [];
};

class Emitter extends TypedEventEmitter<Events> {
  fireGreet(name: string): void {
    this.emit("greet", name);
  }

  firePing(): void {
    this.emit("ping");
  }
}

describe("TypedEventEmitter", () => {
  test("delivers emitted arguments to listeners", () => {
    const emitter = new Emitter();
    const received: string[] = [];

    emitter.on("greet", (name) => received.push(name));
    emitter.fireGreet("rust");

    expect(received).toEqual(["rust"]);
  });

  test("once only fires a single time", () => {
    const emitter = new Emitter();
    let count = 0;

    emitter.once("ping", () => {
      count++;
    });
    emitter.firePing();
    emitter.firePing();

    expect(count).toBe(1);
  });

  test("off removes a listener", () => {
    const emitter = new Emitter();
    let count = 0;
    const listener = () => count++;

    emitter.on("ping", listener);
    emitter.firePing();
    emitter.off("ping", listener);
    emitter.firePing();

    expect(count).toBe(1);
  });
});
