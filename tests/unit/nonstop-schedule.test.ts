import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRepeatedTeamInRound,
  type NonstopMatchAssignment,
} from "../../shared/nonstop-schedule.js";

const assignments: NonstopMatchAssignment[] = [
  { round: 1, court: 1, teamAId: 1, teamBId: 2 },
  { round: 1, court: 2, teamAId: 3, teamBId: 4 },
  { round: 1, court: 3, teamAId: 5, teamBId: 6 },
];

describe("Non Stop round assignments", () => {
  it("accepts a valid round where every team plays once", () => {
    assert.equal(
      findRepeatedTeamInRound(assignments.slice(0, 2), assignments[2]),
      null,
    );
  });

  it("rejects a team already assigned to another court in the round", () => {
    assert.equal(
      findRepeatedTeamInRound(assignments, {
        round: 1,
        court: 3,
        teamAId: 3,
        teamBId: 6,
      }),
      3,
    );
  });

  it("allows updating the teams in the same round and court", () => {
    assert.equal(
      findRepeatedTeamInRound(assignments, {
        round: 1,
        court: 2,
        teamAId: 3,
        teamBId: 4,
      }),
      null,
    );
  });

  it("allows the same teams to play in a different round", () => {
    assert.equal(
      findRepeatedTeamInRound(assignments, {
        round: 2,
        court: 1,
        teamAId: 1,
        teamBId: 2,
      }),
      null,
    );
  });
});
