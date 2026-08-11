import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPresentationRoundPages,
  presentationNeedsPagination,
  shouldCenterPresentationRound,
} from "../../shared/nonstop-presentation.js";

describe("Non Stop presentation rounds", () => {
  it("organizes four rounds into two complete rows", () => {
    assert.deepEqual(buildPresentationRoundPages(4), [[1, 2], [3, 4]]);
  });

  it("keeps the fifth round alone without changing its width", () => {
    assert.deepEqual(buildPresentationRoundPages(5), [[1, 2], [3, 4], [5]]);
    assert.equal(shouldCenterPresentationRound(5, 4), true);
  });

  it("organizes six rounds into three complete rows", () => {
    assert.deepEqual(buildPresentationRoundPages(6), [[1, 2], [3, 4], [5, 6]]);
  });

  it("centers a single round on a paginated final page", () => {
    assert.equal(shouldCenterPresentationRound(1, 0), true);
    assert.equal(shouldCenterPresentationRound(2, 1), false);
  });

  it("can reduce pagination to one round on very short screens", () => {
    assert.deepEqual(buildPresentationRoundPages(4, 1), [[1], [2], [3], [4]]);
  });

  it("paginates only when the real content exceeds the available height", () => {
    assert.equal(presentationNeedsPagination(900, 900), false);
    assert.equal(presentationNeedsPagination(902, 900), false);
    assert.equal(presentationNeedsPagination(903, 900), true);
  });
});
