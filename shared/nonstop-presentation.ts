export function buildPresentationRoundPages(
  roundCount: number,
  roundsPerPage = 2,
): number[][] {
  const safeRoundCount = Number.isFinite(roundCount)
    ? Math.max(0, Math.trunc(roundCount))
    : 0;
  const rounds = Array.from({ length: safeRoundCount }, (_, index) => index + 1);
  const pages: number[][] = [];

  const safeRoundsPerPage = Number.isFinite(roundsPerPage)
    ? Math.max(1, Math.trunc(roundsPerPage))
    : 2;

  for (let index = 0; index < rounds.length; index += safeRoundsPerPage) {
    pages.push(rounds.slice(index, index + safeRoundsPerPage));
  }

  return pages;
}

export function shouldCenterPresentationRound(
  visibleRoundCount: number,
  visibleRoundIndex: number,
): boolean {
  return visibleRoundCount % 2 === 1 && visibleRoundIndex === visibleRoundCount - 1;
}

export function presentationNeedsPagination(
  scrollHeight: number,
  clientHeight: number,
  tolerance = 2,
): boolean {
  return scrollHeight > clientHeight + tolerance;
}
