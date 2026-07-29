export type NonstopMatchAssignment = {
  round: number;
  court: number;
  teamAId: number;
  teamBId: number;
};

export function findRepeatedTeamInRound(
  existingAssignments: NonstopMatchAssignment[],
  candidate: NonstopMatchAssignment,
): number | null {
  const candidateTeamIds = new Set([candidate.teamAId, candidate.teamBId]);

  for (const assignment of existingAssignments) {
    if (
      assignment.round !== candidate.round ||
      assignment.court === candidate.court
    ) {
      continue;
    }

    if (candidateTeamIds.has(assignment.teamAId)) return assignment.teamAId;
    if (candidateTeamIds.has(assignment.teamBId)) return assignment.teamBId;
  }

  return null;
}
