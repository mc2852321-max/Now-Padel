import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { startResilientTicker } from "../../client/src/lib/resilient-ticker.js";

const originalWorker = globalThis.Worker;
const originalBlob = globalThis.Blob;
const originalUrl = globalThis.URL;
const originalWindow = globalThis.window;

afterEach(() => {
  Object.assign(globalThis, {
    Worker: originalWorker,
    Blob: originalBlob,
    URL: originalUrl,
    window: originalWindow,
  });
});

describe("resilient Non Stop ticker", () => {
  it("uses a worker and releases every resource when stopped", () => {
    let workerInstance: FakeWorker | null = null;
    let revokedUrl = "";

    class FakeWorker {
      onmessage: (() => void) | null = null;
      messages: string[] = [];
      terminated = false;

      constructor(public readonly url: string) {
        workerInstance = this;
      }

      postMessage(message: string) {
        this.messages.push(message);
      }

      terminate() {
        this.terminated = true;
      }
    }

    Object.assign(globalThis, {
      Worker: FakeWorker,
      Blob: class FakeBlob {},
      URL: {
        createObjectURL: () => "blob:nonstop-ticker",
        revokeObjectURL: (url: string) => { revokedUrl = url; },
      },
    });

    let ticks = 0;
    const stop = startResilientTicker(() => { ticks += 1; });
    assert.ok(workerInstance);
    assert.deepEqual(workerInstance.messages, ["start"]);

    workerInstance.onmessage?.();
    assert.equal(ticks, 1);

    stop();
    assert.deepEqual(workerInstance.messages, ["start", "stop"]);
    assert.equal(workerInstance.terminated, true);
    assert.equal(revokedUrl, "blob:nonstop-ticker");
  });

  it("falls back to a window interval when workers are unavailable", () => {
    let intervalCallback: (() => void) | null = null;
    let clearedId: number | null = null;

    Object.assign(globalThis, {
      Worker: undefined,
      window: {
        setInterval: (callback: () => void) => {
          intervalCallback = callback;
          return 77;
        },
        clearInterval: (id: number) => { clearedId = id; },
      },
    });

    let ticks = 0;
    const stop = startResilientTicker(() => { ticks += 1; });
    assert.equal(ticks, 1);

    intervalCallback?.();
    assert.equal(ticks, 2);

    stop();
    assert.equal(clearedId, 77);
  });
});
