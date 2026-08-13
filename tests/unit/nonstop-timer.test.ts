import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRemainingTimerSeconds, resolveTimerTimeLeft } from "../../shared/nonstop-timer.js";

describe("Non Stop timer clock", () => {
  it("calculates remaining seconds from an absolute phase end", () => {
    assert.equal(getRemainingTimerSeconds(11_000, 1_000), 10);
    assert.equal(getRemainingTimerSeconds(10_001, 1_000), 10);
    assert.equal(getRemainingTimerSeconds(999, 1_000), 0);
  });

  it("uses phaseEndsAt instead of stale stored time when the timer is active", () => {
    assert.equal(resolveTimerTimeLeft(true, 120_000, 60, 0), 120);
  });

  it("uses stored time when the timer is paused", () => {
    assert.equal(resolveTimerTimeLeft(false, 120_000, 60, 0), 60);
  });
});
