export function getRemainingTimerSeconds(
  phaseEndsAt: number | string | Date | null | undefined,
  now = Date.now(),
) {
  if (!phaseEndsAt) return 0;
  const endAt = phaseEndsAt instanceof Date
    ? phaseEndsAt.getTime()
    : typeof phaseEndsAt === "number" ? phaseEndsAt : new Date(phaseEndsAt).getTime();
  if (!Number.isFinite(endAt)) return 0;
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

export function resolveTimerTimeLeft(
  isActive: boolean,
  phaseEndsAt: number | string | Date | null | undefined,
  storedTimeLeft: number | null | undefined,
  now = Date.now(),
) {
  if (isActive && phaseEndsAt) return getRemainingTimerSeconds(phaseEndsAt, now);
  return Math.max(0, Math.floor(storedTimeLeft ?? 0));
}

export function shouldRefreshNonstopTimerBoundary(
  remainingSeconds: number,
  phaseEndsAt: number | null | undefined,
  lastRefreshedPhaseEndsAt: number | null | undefined,
): boolean {
  return remainingSeconds <= 0 && typeof phaseEndsAt === "number" &&
    Number.isFinite(phaseEndsAt) && phaseEndsAt > 0 && lastRefreshedPhaseEndsAt !== phaseEndsAt;
}
