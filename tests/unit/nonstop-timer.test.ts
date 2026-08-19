import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRemainingTimerSeconds, resolveTimerTimeLeft, shouldRefreshNonstopTimerBoundary } from "../../shared/nonstop-timer.js";

describe("Non Stop timer clock", () => {
  it("calculates remaining seconds from an absolute phase end", () => {
    assert.equal(getRemainingTimerSeconds(11_000, 1_000), 10);
    assert.equal(getRemainingTimerSeconds(10_001, 1_000), 10);
    assert.equal(getRemainingTimerSeconds(999, 1_000), 0);
  });

  it("uses phaseEndsAt instead of stale stored time when active", () => {
    assert.equal(resolveTimerTimeLeft(true, 120_000, 60, 0), 120);
  });

  it("uses stored time when paused", () => {
    assert.equal(resolveTimerTimeLeft(false, 120_000, 60, 0), 60);
  });

  it("catches up after the real seven-minute background-tab gap", () => {
    const startedAt = 1_000_000;
    const endsAt = startedAt + 20 * 60_000;
    assert.equal(resolveTimerTimeLeft(true, endsAt, 0, startedAt + 6 * 60_000), 14 * 60);
    assert.equal(resolveTimerTimeLeft(true, endsAt, 14 * 60, startedAt + 13 * 60_000), 7 * 60);
    assert.equal(resolveTimerTimeLeft(true, endsAt, 7 * 60, endsAt), 0);
  });

  it("refreshes the server exactly once for each completed phase", () => {
    assert.equal(shouldRefreshNonstopTimerBoundary(1, 100_000, null), false);
    assert.equal(shouldRefreshNonstopTimerBoundary(0, 100_000, null), true);
    assert.equal(shouldRefreshNonstopTimerBoundary(0, 100_000, 100_000), false);
    assert.equal(shouldRefreshNonstopTimerBoundary(0, 160_000, 100_000), true);
  });

  it("continues from a new server phase after reaching zero", () => {
    assert.equal(getRemainingTimerSeconds(100_000, 100_000), 0);
    assert.equal(shouldRefreshNonstopTimerBoundary(0, 100_000, null), true);
    assert.equal(resolveTimerTimeLeft(true, 1_300_000, 0, 100_000), 20 * 60);
  });

  it("survives a complete warmup, five-round and rest schedule", () => {
    const durations = [10, 20, 3, 20, 3, 20, 3, 20, 3, 20].map((minutes) => minutes * 60_000);
    let startedAt = 5_000_000;
    durations.forEach((duration) => {
      const endsAt = startedAt + duration;
      assert.equal(resolveTimerTimeLeft(true, endsAt, 0, startedAt), duration / 1000);
      assert.equal(getRemainingTimerSeconds(endsAt, endsAt - 30_000), 30);
      assert.equal(getRemainingTimerSeconds(endsAt, endsAt + 120_000), 0);
      assert.equal(shouldRefreshNonstopTimerBoundary(0, endsAt, null), true);
      assert.equal(shouldRefreshNonstopTimerBoundary(0, endsAt, endsAt), false);
      startedAt = endsAt;
    });
  });
});
