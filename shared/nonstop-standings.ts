export type NonstopStandingForComparison = {
  teamId: number;
  gamesWon: number;
  gamesLost: number;
};

export type NonstopResultForComparison = {
  teamAId: number;
  teamBId: number;
  scoreA: number | null;
  scoreB: number | null;
};

export function compareTiedNonstopStandings(
  a: NonstopStandingForComparison,
  b: NonstopStandingForComparison,
  results: NonstopResultForComparison[],
  useDirectComparison: boolean,
): number {
  if (useDirectComparison) {
    let directWinsA = 0;
    let directWinsB = 0;
    let directGameDifferenceA = 0;

    for (const result of results) {
      const isDirectMatch =
        (result.teamAId === a.teamId && result.teamBId === b.teamId) ||
        (result.teamAId === b.teamId && result.teamBId === a.teamId);
      if (!isDirectMatch || result.scoreA === null || result.scoreB === null) continue;
      if (result.scoreA === 0 && result.scoreB === 0) continue;

      const scoreA = result.teamAId === a.teamId ? result.scoreA : result.scoreB;
      const scoreB = result.teamAId === b.teamId ? result.scoreA : result.scoreB;
      directGameDifferenceA += scoreA - scoreB;

      if (scoreA > scoreB) directWinsA += 1;
      else if (scoreB > scoreA) directWinsB += 1;
    }

    if (directWinsA !== directWinsB) return directWinsB - directWinsA;
    if (directGameDifferenceA !== 0) return -directGameDifferenceA;
  }

  const diffA = a.gamesWon - a.gamesLost;
  const diffB = b.gamesWon - b.gamesLost;
  return diffB - diffA;
}
