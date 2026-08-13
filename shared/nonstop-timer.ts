export function getRemainingTimerSeconds(
  phaseEndsAt: number | string | Date | null | undefined,
  now = Date.now(),
) {
  if (!phaseEndsAt) return 0;

  const endAt = phaseEndsAt instanceof Date
    ? phaseEndsAt.getTime()
    : typeof phaseEndsAt === "number"
      ? phaseEndsAt
      : new Date(phaseEndsAt).getTime();

  if (!Number.isFinite(endAt)) return 0;

  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

export function resolveTimerTimeLeft(
  isActive: boolean,
  phaseEndsAt: number | string | Date | null | undefined,
  storedTimeLeft: number | null | undefined,
  now = Date.now(),
) {
  if (isActive && phaseEndsAt) {
    return getRemainingTimerSeconds(phaseEndsAt, now);
  }

  return Math.max(0, Math.floor(storedTimeLeft ?? 0));
}
