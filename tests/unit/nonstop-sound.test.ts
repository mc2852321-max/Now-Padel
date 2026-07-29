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

  it("blocks sounds in hidden control tabs", () => {
    assert.equal(canPlayNonstopSound(false, "hidden"), false);
  });

  it("blocks sounds when no browser document is available", () => {
    assert.equal(canPlayNonstopSound(false, "unavailable"), false);
  });
});
