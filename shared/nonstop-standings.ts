export type NonstopStandingForComparison = {
  teamId: number;
  points: number;
  gamesWon: number;
  gamesLost: number;
};

export type NonstopResultForComparison = {
  teamAId: number;
  teamBId: number;
  scoreA: number | null;
  scoreB: number | null;
};

type MiniStanding = {
  points: number;
  gamesWon: number;
  gamesLost: number;
};

function isPlayedResult(
  result: NonstopResultForComparison,
): result is NonstopResultForComparison & { scoreA: number; scoreB: number } {
  return (
    result.scoreA !== null &&
    result.scoreB !== null &&
    (result.scoreA > 0 || result.scoreB > 0)
  );
}

function buildMiniStandings(
  tiedTeamIds: Set<number>,
  results: NonstopResultForComparison[],
): Map<number, MiniStanding> {
  const miniStandings = new Map<number, MiniStanding>();
  for (const teamId of Array.from(tiedTeamIds)) {
    miniStandings.set(teamId, { points: 0, gamesWon: 0, gamesLost: 0 });
  }

  for (const result of results) {
    if (
      !tiedTeamIds.has(result.teamAId) ||
      !tiedTeamIds.has(result.teamBId) ||
      !isPlayedResult(result)
    ) {
      continue;
    }

    const teamA = miniStandings.get(result.teamAId)!;
    const teamB = miniStandings.get(result.teamBId)!;
    teamA.gamesWon += result.scoreA;
    teamA.gamesLost += result.scoreB;
    teamB.gamesWon += result.scoreB;
    teamB.gamesLost += result.scoreA;

    if (result.scoreA > result.scoreB) teamA.points += 1;
    else if (result.scoreB > result.scoreA) teamB.points += 1;
  }

  return miniStandings;
}

function compareGeneralCriteria(
  a: NonstopStandingForComparison,
  b: NonstopStandingForComparison,
): number {
  const differenceA = a.gamesWon - a.gamesLost;
  const differenceB = b.gamesWon - b.gamesLost;
  if (differenceB !== differenceA) return differenceB - differenceA;
  if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;

  // Stable, deterministic final criterion shared by the browser and server.
  return a.teamId - b.teamId;
}

function sortTiedGroup<T extends NonstopStandingForComparison>(
  tiedStandings: T[],
  results: NonstopResultForComparison[],
  useDirectComparison: boolean,
): T[] {
  if (!useDirectComparison) {
    return [...tiedStandings].sort(compareGeneralCriteria);
  }

  const tiedTeamIds = new Set(tiedStandings.map((standing) => standing.teamId));
  const miniStandings = buildMiniStandings(tiedTeamIds, results);

  return [...tiedStandings].sort((a, b) => {
    const miniA = miniStandings.get(a.teamId)!;
    const miniB = miniStandings.get(b.teamId)!;

    if (miniB.points !== miniA.points) return miniB.points - miniA.points;

    const miniDifferenceA = miniA.gamesWon - miniA.gamesLost;
    const miniDifferenceB = miniB.gamesWon - miniB.gamesLost;
    if (miniDifferenceB !== miniDifferenceA) {
      return miniDifferenceB - miniDifferenceA;
    }
    if (miniB.gamesWon !== miniA.gamesWon) {
      return miniB.gamesWon - miniA.gamesWon;
    }

    return compareGeneralCriteria(a, b);
  });
}

export function sortNonstopStandings<T extends NonstopStandingForComparison>(
  standings: T[],
  results: NonstopResultForComparison[],
  useDirectComparison: boolean,
): T[] {
  const standingsByPoints = new Map<number, T[]>();
  for (const standing of standings) {
    const group = standingsByPoints.get(standing.points) ?? [];
    group.push(standing);
    standingsByPoints.set(standing.points, group);
  }

  return Array.from(standingsByPoints.entries())
    .sort(([pointsA], [pointsB]) => pointsB - pointsA)
    .flatMap(([, tiedStandings]) =>
      sortTiedGroup(tiedStandings, results, useDirectComparison),
    );
}
