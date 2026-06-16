export type RankingSeasonConfig = {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
};

export type RankingSeasonOption = RankingSeasonConfig & {
  configured: boolean;
};

export const RANKING_SEASON_ID_MIN = 2000;
export const RANKING_SEASON_ID_MAX = 999999;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getDefaultRankingSeasons(year = 2026): RankingSeasonConfig[] {
  const usesNowPadel2026Calendar = year === 2026;
  return [
    { id: year * 100 + 1, name: `1.º Trimestre ${year}`, startsAt: `${year}-01-01`, endsAt: `${year}-03-31` },
    { id: year * 100 + 2, name: `2.º Trimestre ${year}`, startsAt: `${year}-04-01`, endsAt: usesNowPadel2026Calendar ? `${year}-05-31` : `${year}-06-30` },
    { id: year * 100 + 3, name: `3.º Trimestre ${year}`, startsAt: usesNowPadel2026Calendar ? `${year}-06-01` : `${year}-07-01`, endsAt: `${year}-09-30` },
    { id: year * 100 + 4, name: `4.º Trimestre ${year}`, startsAt: `${year}-10-01`, endsAt: `${year}-12-31` },
  ];
}

export const DEFAULT_RANKING_SEASONS = getDefaultRankingSeasons(2026);
export const DEFAULT_RANKING_SEASONS_JSON = JSON.stringify(DEFAULT_RANKING_SEASONS);

function isValidDateString(value: string) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function normalizeName(value: unknown, fallback: string) {
  const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (clean || fallback).slice(0, 80).trim() || fallback;
}

export function normalizeRankingSeasonId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < RANKING_SEASON_ID_MIN || parsed > RANKING_SEASON_ID_MAX) return null;
  return parsed;
}

export function parseRankingSeasons(raw: unknown, fallback = DEFAULT_RANKING_SEASONS): RankingSeasonConfig[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return fallback;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  if (!Array.isArray(parsed)) return fallback;

  const unique = new Map<number, RankingSeasonConfig>();
  parsed.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id = normalizeRankingSeasonId(record.id);
    const startsAt = typeof record.startsAt === "string" ? record.startsAt : "";
    const endsAt = typeof record.endsAt === "string" ? record.endsAt : "";
    if (!id || !isValidDateString(startsAt) || !isValidDateString(endsAt)) return;
    if (startsAt > endsAt) return;

    const normalizedSeason = {
      id,
      name: normalizeName(record.name, `Temporada ${id || index + 1}`),
      startsAt,
      endsAt,
    };
    if (id === 202602 && normalizedSeason.endsAt === "2026-06-30") {
      normalizedSeason.endsAt = "2026-05-31";
    }
    if (id === 202603 && normalizedSeason.startsAt === "2026-07-01") {
      normalizedSeason.startsAt = "2026-06-01";
    }

    unique.set(id, normalizedSeason);
  });

  if (unique.size === 0) return fallback;
  return Array.from(unique.values()).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
}

export function serializeRankingSeasons(raw: unknown) {
  return JSON.stringify(parseRankingSeasons(raw));
}

export function getRankingSeasonLabel(seasonId: number, configuredSeasons: RankingSeasonConfig[] = []) {
  return configuredSeasons.find((season) => season.id === seasonId)?.name ?? `Temporada ${seasonId}`;
}

export function getRankingSeasonForDate(
  rawSeasons: unknown,
  dateLike: Date | string | null | undefined,
  fallbackYear?: number,
): RankingSeasonConfig {
  const seasons = parseRankingSeasons(rawSeasons);
  const date = dateLike ? new Date(dateLike) : new Date();
  const isoDay = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);

  const match = seasons.find((season) => season.startsAt <= isoDay && isoDay <= season.endsAt);
  if (match) return match;

  const year = (fallbackYear ?? Number(isoDay.slice(0, 4))) || new Date().getUTCFullYear();
  return {
    id: year,
    name: `Temporada ${year}`,
    startsAt: `${year}-01-01`,
    endsAt: `${year}-12-31`,
  };
}

export function buildRankingSeasonOptions(
  configuredSeasons: RankingSeasonConfig[],
  discoveredSeasonIds: number[],
): RankingSeasonOption[] {
  const configured = parseRankingSeasons(configuredSeasons);
  const byId = new Map<number, RankingSeasonOption>();

  for (const season of configured) {
    byId.set(season.id, { ...season, configured: true });
  }

  for (const id of discoveredSeasonIds) {
    const normalizedId = normalizeRankingSeasonId(id);
    if (!normalizedId || byId.has(normalizedId)) continue;
    const year = normalizedId >= 2000 && normalizedId <= 3000 ? normalizedId : Math.floor(normalizedId / 100);
    byId.set(normalizedId, {
      id: normalizedId,
      name: `Temporada ${normalizedId}`,
      startsAt: `${year}-01-01`,
      endsAt: `${year}-12-31`,
      configured: false,
    });
  }

  return Array.from(byId.values()).sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.id - a.id);
}
