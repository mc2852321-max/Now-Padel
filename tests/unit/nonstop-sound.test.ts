import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPlayNonstopSound } from "../../shared/nonstop-sound.js";

describe("Non Stop sound ownership", () => {
  it("allows sounds on the visible control page", () => {
    assert.equal(canPlayNonstopSound(false, "visible"), true);
  });

  it("blocks sounds in presentation mode", () => {
    assert.equal(canPlayNonstopSound(true, "visible"), false);
  });

  it("allows sounds when the control page is minimized", () => {
    assert.equal(canPlayNonstopSound(false, "hidden"), true);
  });

  it("blocks sounds when presentation mode is minimized", () => {
    assert.equal(canPlayNonstopSound(true, "hidden"), false);
  });

  it("blocks sounds when no browser document is available", () => {
    assert.equal(canPlayNonstopSound(false, "unavailable"), false);
  });
});
