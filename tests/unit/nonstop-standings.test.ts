import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sortNonstopStandings,
  type NonstopResultForComparison,
  type NonstopStandingForComparison,
} from "../../shared/nonstop-standings.js";

function standing(
  teamId: number,
  points: number,
  gamesWon: number,
  gamesLost: number,
): NonstopStandingForComparison {
  return { teamId, points, gamesWon, gamesLost };
}

function result(
  teamAId: number,
  teamBId: number,
  scoreA: number,
  scoreB: number,
): NonstopResultForComparison {
  return { teamAId, teamBId, scoreA, scoreB };
}

function orderedTeamIds(
  standings: NonstopStandingForComparison[],
  results: NonstopResultForComparison[],
): number[] {
  return sortNonstopStandings(standings, results, true).map(
    (row) => row.teamId,
  );
}

describe("Non Stop standings tie-breaks", () => {
  it("uses the head-to-head result when exactly two teams are tied", () => {
    const standings = [
      standing(1, 12, 20, 10),
      standing(2, 12, 14, 13),
    ];

    assert.deepEqual(orderedTeamIds(standings, [result(2, 1, 6, 4)]), [2, 1]);
  });

  it("builds a mini-table with a clear winner for three tied teams", () => {
    const standings = [
      standing(1, 12, 20, 18),
      standing(2, 12, 19, 17),
      standing(3, 12, 18, 16),
    ];
    const results = [
      result(1, 2, 6, 4),
      result(1, 3, 5, 3),
      result(2, 3, 6, 2),
    ];

    assert.deepEqual(orderedTeamIds(standings, results), [1, 2, 3]);
  });

  it("resolves a circular three-team tie using the mini-table difference", () => {
    const standings = [
      standing(1, 12, 20, 16), // Pombinhos: overall +4
      standing(2, 12, 21, 15), // Ronaldinhos: overall +6
      standing(3, 12, 30, 9), // Chinoca/Pereirinha: overall +21
    ];
    const results = [
      result(1, 2, 6, 4),
      result(2, 3, 5, 4),
      result(3, 1, 5, 3),
    ];

    assert.deepEqual(orderedTeamIds(standings, results), [3, 1, 2]);
  });

  it("falls back to the overall game difference when the mini-table remains tied", () => {
    const standings = [
      standing(1, 12, 20, 16),
      standing(2, 12, 22, 16),
      standing(3, 12, 30, 9),
    ];
    const results = [
      result(1, 2, 5, 4),
      result(2, 3, 5, 4),
      result(3, 1, 5, 4),
    ];

    assert.deepEqual(orderedTeamIds(standings, results), [3, 2, 1]);
  });

  it("falls back to overall games won when the overall difference is also tied", () => {
    const standings = [
      standing(1, 12, 20, 15),
      standing(2, 12, 24, 19),
      standing(3, 12, 22, 17),
    ];
    const results = [
      result(1, 2, 5, 4),
      result(2, 3, 5, 4),
      result(3, 1, 5, 4),
    ];

    assert.deepEqual(orderedTeamIds(standings, results), [2, 3, 1]);
  });

  it("uses the team id as a deterministic final criterion for a total tie", () => {
    const standings = [
      standing(30, 12, 20, 15),
      standing(10, 12, 20, 15),
      standing(20, 12, 20, 15),
    ];
    const results = [
      result(10, 20, 5, 4),
      result(20, 30, 5, 4),
      result(30, 10, 5, 4),
    ];

    assert.deepEqual(orderedTeamIds(standings, results), [10, 20, 30]);
  });
});
