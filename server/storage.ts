import {
  players,
  teams,
  nonstopResults,
  nonstopTimer,
  nonstopEvents,
  settings,
  rankingEntries,
  authorizedUsers,
  type Player,
  type InsertPlayer,
  type UpdatePlayerRequest,
  type Team,
  type InsertTeam,
  type NonstopResult,
  type InsertNonstopResult,
  type NonstopTimer,
  type InsertNonstopTimer,
  type NonstopEvent,
  type Settings,
  type InsertSettings,
  type RankingEntry,
  type InsertRankingEntry,
  type AuthorizedUser,
  type InsertAuthorizedUser,
} from "../shared/schema.js";
import { db, hasDatabase } from "./db.js";
import { eq, and, or, ilike, desc, count, sql, inArray } from "drizzle-orm";
import { LocalStorage } from "./local-storage.js";

type DbExecutor = typeof db;
type NonstopEventStatus = "draft" | "active" | "completed" | "cancelled";
const LISBON_TIMEZONE = "Europe/Lisbon";
const DEFAULT_NONSTOP_TIME = "21:30";

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:(\+|-)(\d{1,2})(?::?(\d{2}))?)?$/.exec(offsetPart);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

export function getLisbonDateInput(dateLike: Date | string | null | undefined = new Date()): string {
  const value = dateLike ? new Date(dateLike) : new Date();
  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value;
  return safeValue.toLocaleDateString("sv-SE", { timeZone: LISBON_TIMEZONE });
}

export function getLisbonTimeInput(dateLike: Date | string | null | undefined = new Date()): string {
  const value = dateLike ? new Date(dateLike) : new Date();
  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value;
  return safeValue.toLocaleTimeString("pt-PT", {
    timeZone: LISBON_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function createLisbonDateTime(dateValue: string, timeValue = DEFAULT_NONSTOP_TIME): Date {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, LISBON_TIMEZONE);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function getDefaultNonstopStartedAt(): Date {
  return createLisbonDateTime(getLisbonDateInput(new Date()), DEFAULT_NONSTOP_TIME);
}

export type PlayersPage = {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type NonstopEventSummary = Pick<
  NonstopEvent,
  "id" | "status" | "label" | "category" | "createdAt" | "startedAt" | "completedAt"
>;

export type NonstopEventDetails = {
  event: NonstopEvent;
  teams: Team[];
  results: NonstopResult[];
  timer: NonstopTimer;
  snapshot: any | null;
};

export type RankingLeaderboardRow = {
  playerId: number;
  name: string;
  level: string;
  totalPoints: number;
  importedPoints: number;
  participationCount: number;
  roundWins: number;
  lastEntryAt: Date | null;
};

export type RankingHistoryTopPlayer = {
  position: number;
  playerId: number;
  name: string;
  level: string;
  totalPoints: number;
};

export type RankingSeasonHistoryRow = {
  season: number;
  totalPlayers: number;
  totalPoints: number;
  importedPoints: number;
  lastEntryAt: Date | null;
  topPlayers: RankingHistoryTopPlayer[];
};

export type RankingImportRow = {
  playerId: number;
  points: number;
  note?: string;
};

export interface IStorage {
  // Players
  getPlayers(filters?: { level?: string }): Promise<Player[]>;
  getPlayersPaginated(filters?: { level?: string; search?: string; profileTags?: string[]; page?: number; pageSize?: number }): Promise<PlayersPage>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(id: number, player: UpdatePlayerRequest): Promise<Player>;
  deletePlayer(id: number): Promise<void>;

  // Nonstop events
  getCurrentNonstopEvent(): Promise<NonstopEvent>;
  listNonstopEvents(filters?: { from?: Date; to?: Date }): Promise<NonstopEventSummary[]>;
  getNonstopEventById(id: number): Promise<NonstopEvent | null>;
  updateNonstopEventMetadata(id: number, update: { label?: string | null; startedAt?: Date | null; category?: string | null }): Promise<NonstopEvent | null>;
  getNonstopEventDetails(id: number): Promise<NonstopEventDetails | null>;
  deleteNonstopEvent(id: number): Promise<{ deletedEventId: number; deletedRankingEntries: number }>;
  finalizeAndStartNonstop(opts?: { label?: string; userEmail?: string | null }): Promise<{ completedEventId: number; newEvent: NonstopEvent }>;
  purgeOldNonstopEvents(retentionDays?: number): Promise<number>;

  // Teams
  getTeams(eventId?: number): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: InsertTeam): Promise<Team>;
  deleteTeam(id: number): Promise<void>;

  // Results
  getResults(eventId?: number): Promise<NonstopResult[]>;
  createOrUpdateResult(result: InsertNonstopResult): Promise<NonstopResult>;
  clearResults(): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;
  getNonstopTimer(eventId?: number): Promise<NonstopTimer>;
  updateNonstopTimer(timer: Partial<InsertNonstopTimer>): Promise<NonstopTimer>;
  resetNonstop(): Promise<void>;

  // Ranking
  getRankingLeaderboard(seasonYear?: number, category?: string): Promise<RankingLeaderboardRow[]>;
  getRankingEntries(playerId?: number, seasonYear?: number, category?: string): Promise<RankingEntry[]>;
  getRankingSeasons(): Promise<number[]>;
  getRankingCategories(): Promise<string[]>;
  getRankingHistory(opts?: { category?: string; limitSeasons?: number }): Promise<RankingSeasonHistoryRow[]>;
  importRankingBasePoints(rows: RankingImportRow[], opts?: { batchLabel?: string; seasonYear?: number; category?: string; userEmail?: string | null }): Promise<number>;

  // Authorized Users
  getAuthorizedUsers(): Promise<AuthorizedUser[]>;
  getAuthorizedUserById(id: number): Promise<AuthorizedUser | null>;
  createAuthorizedUser(user: InsertAuthorizedUser): Promise<AuthorizedUser>;
  deleteAuthorizedUser(id: number): Promise<void>;
  isEmailAuthorized(email: string): Promise<boolean>;
  getAuthorizedUserByEmail(email: string): Promise<AuthorizedUser | null>;
  setUserPassword(id: number, hashedPassword: string): Promise<AuthorizedUser>;
}

const RANKING_PARTICIPATION_POINTS = 2;
const RANKING_MAX_WIN_POINTS_PER_EVENT = 15;
const RANKING_DEFAULT_ROUND_WIN_POINTS = 3;
const DEFAULT_NONSTOP_CATEGORY = "Non Stop";
const RANKING_HISTORY_SEASONS_TO_KEEP = 2;
const RANKING_ALL_CATEGORIES_TOKEN = "__all__";

export function resolveNonstopRoundWinPoints(nonstopCourts?: number | null, nonstopRounds?: number | null): number {
  const courts = Number.isFinite(nonstopCourts) ? Math.max(1, Number(nonstopCourts)) : 0;
  const rounds = Number.isFinite(nonstopRounds) ? Math.max(1, Number(nonstopRounds)) : 0;

  if (rounds > 0) {
    return RANKING_MAX_WIN_POINTS_PER_EVENT / rounds;
  }

  if (courts === 2) return 5;
  if (courts === 3) return 3;

  return RANKING_DEFAULT_ROUND_WIN_POINTS;
}

export function resolveNonstopStandingsPoints(
  roundWins: number,
  nonstopCourts?: number | null,
  nonstopRounds?: number | null,
): number {
  const wins = Number.isFinite(roundWins) ? Math.max(0, Number(roundWins)) : 0;
  if (wins <= 0) return 0;

  return Math.round(wins * resolveNonstopRoundWinPoints(nonstopCourts, nonstopRounds));
}

function computeStandings(
  allTeams: Team[],
  allResults: NonstopResult[],
  tieBreaker: "direct" | "diff",
  numRounds: number,
) {
  const standings: Record<number, { points: number; gamesWon: number; gamesLost: number; teamId: number; name: string; sequence: string[] }> = {};
  const roundWins: Record<number, number> = {};

  allTeams.forEach((team) => {
    standings[team.id] = {
      points: 0,
      gamesWon: 0,
      gamesLost: 0,
      teamId: team.id,
      name: team.name,
      sequence: [],
    };
    roundWins[team.id] = 0;
  });

  allResults.forEach((result) => {
    const teamA = standings[result.teamAId];
    const teamB = standings[result.teamBId];
    if (!teamA || !teamB) return;

    teamA.gamesWon += result.scoreA;
    teamA.gamesLost += result.scoreB;
    teamB.gamesWon += result.scoreB;
    teamB.gamesLost += result.scoreA;

    const hasPlayed = result.scoreA > 0 || result.scoreB > 0;
    if (!hasPlayed) return;
    if (result.scoreA > result.scoreB) {
      roundWins[teamA.teamId] += 1;
    } else if (result.scoreB > result.scoreA) {
      roundWins[teamB.teamId] += 1;
    }
  });

  Object.values(standings).forEach((teamStandings) => {
    teamStandings.points = resolveNonstopStandingsPoints(roundWins[teamStandings.teamId] ?? 0, null, numRounds);
  });

  allTeams.forEach((team) => {
    const teamStandings = standings[team.id];
    for (let r = 1; r <= numRounds; r += 1) {
      const roundResult = allResults.find((res) => res.round === r && (res.teamAId === team.id || res.teamBId === team.id));
      if (!roundResult) {
        teamStandings.sequence.push("-");
        continue;
      }
      const isTeamA = roundResult.teamAId === team.id;
      const score = isTeamA ? roundResult.scoreA : roundResult.scoreB;
      const oppScore = isTeamA ? roundResult.scoreB : roundResult.scoreA;
      const hasPlayed = (score ?? 0) > 0 || (oppScore ?? 0) > 0;
      if (!hasPlayed) teamStandings.sequence.push("-");
      else if ((score ?? 0) > (oppScore ?? 0)) teamStandings.sequence.push("V");
      else if ((score ?? 0) < (oppScore ?? 0)) teamStandings.sequence.push("D");
      else teamStandings.sequence.push("E");
    }
  });

  return Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;

    if (tieBreaker === "direct") {
      const directMatch = allResults.find((r) =>
        (r.teamAId === a.teamId && r.teamBId === b.teamId) ||
        (r.teamAId === b.teamId && r.teamBId === a.teamId),
      );
      if (directMatch && directMatch.scoreA !== null && directMatch.scoreB !== null) {
        const aScore = directMatch.teamAId === a.teamId ? directMatch.scoreA : directMatch.scoreB;
        const bScore = directMatch.teamAId === b.teamId ? directMatch.scoreA : directMatch.scoreB;
        if (aScore !== bScore) return bScore - aScore;
      }
    }

    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    return diffB - diffA;
  });
}

export class DatabaseStorage implements IStorage {
  private normalizeRankingPoints(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private formatRankingPoints(value: number): string {
    const normalized = this.normalizeRankingPoints(value);
    if (Number.isInteger(normalized)) return String(normalized);
    return normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  }

  private resolveRoundWinPoints(nonstopCourts?: number | null, nonstopRounds?: number | null): number {
    return resolveNonstopRoundWinPoints(nonstopCourts, nonstopRounds);
  }

  private getLisbonYear(dateLike: Date | string | null | undefined): number {
    const value = dateLike ? new Date(dateLike) : new Date();
    if (Number.isNaN(value.getTime())) return new Date().getUTCFullYear();
    const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: LISBON_TIMEZONE, year: "numeric" }).format(value));
    if (!Number.isInteger(year)) return new Date().getUTCFullYear();
    return year;
  }

  private getCurrentSeasonYear(): number {
    return this.getLisbonYear(new Date());
  }

  private async pruneOldRankingSeasons(
    seasonsToKeep = RANKING_HISTORY_SEASONS_TO_KEEP,
    executor: DbExecutor = db,
  ): Promise<number> {
    const safeSeasonsToKeep = Number.isFinite(seasonsToKeep)
      ? Math.max(1, Math.trunc(Number(seasonsToKeep)))
      : RANKING_HISTORY_SEASONS_TO_KEEP;
    const oldestSeasonToKeep = this.getCurrentSeasonYear() - (safeSeasonsToKeep - 1);
    const deleted = await executor
      .delete(rankingEntries)
      .where(sql`${rankingEntries.seasonYear} < ${oldestSeasonToKeep}`)
      .returning({ id: rankingEntries.id });
    return deleted.length;
  }

  private resolveSeasonYearInput(seasonYear?: number): number {
    if (typeof seasonYear === "number" && Number.isInteger(seasonYear) && seasonYear >= 2000 && seasonYear <= 3000) {
      return seasonYear;
    }
    return this.getCurrentSeasonYear();
  }

  private isAllCategoriesSelection(value: unknown): boolean {
    return typeof value === "string" && value.trim().toLowerCase() === RANKING_ALL_CATEGORIES_TOKEN;
  }

  private normalizeNonstopCategory(value: unknown, fallback = DEFAULT_NONSTOP_CATEGORY): string {
    const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!cleaned) return fallback;
    if (cleaned.length <= 60) return cleaned;
    return cleaned.slice(0, 60).trim() || fallback;
  }

  private parseNonstopCategories(raw: unknown): string[] {
    if (typeof raw !== "string" || !raw.trim()) {
      return [DEFAULT_NONSTOP_CATEGORY];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [DEFAULT_NONSTOP_CATEGORY];
    }

    if (!Array.isArray(parsed)) {
      return [DEFAULT_NONSTOP_CATEGORY];
    }

    const unique = new Set<string>();
    for (const item of parsed) {
      const category = this.normalizeNonstopCategory(item, "");
      if (!category) continue;
      unique.add(category);
    }

    if (unique.size === 0) {
      return [DEFAULT_NONSTOP_CATEGORY];
    }

    return Array.from(unique);
  }

  private serializeNonstopCategories(raw: unknown): string {
    return JSON.stringify(this.parseNonstopCategories(raw));
  }

  private categoryKey(category: string): string {
    return encodeURIComponent(this.normalizeNonstopCategory(category));
  }

  private getSeasonYearFromEvent(event: Pick<NonstopEvent, "startedAt" | "createdAt">): number {
    return this.getLisbonYear(event.startedAt ?? event.createdAt);
  }

  private getTeamPlayerIds(team: Team): number[] {
    const ids = [team.playerAId, team.playerBId].filter((id): id is number => typeof id === "number" && id > 0);
    return Array.from(new Set(ids));
  }

  private async createRankingEntry(
    entry: InsertRankingEntry,
    executor: DbExecutor = db,
  ): Promise<boolean> {
    const inserted = await executor
      .insert(rankingEntries)
      .values(entry)
      .onConflictDoNothing({ target: [rankingEntries.reasonKey] })
      .returning({ id: rankingEntries.id });

    return inserted.length > 0;
  }

  private async validateTeamPlayersExist(
    playerAId: number,
    playerBId: number,
    executor: DbExecutor = db,
  ): Promise<void> {
    const playerIds = Array.from(new Set([playerAId, playerBId]));
    if (playerIds.length === 0) return;

    const whereClause = playerIds.length > 1
      ? inArray(players.id, playerIds)
      : eq(players.id, playerIds[0]);

    const existing = await executor
      .select({ id: players.id })
      .from(players)
      .where(whereClause);

    if (existing.length !== playerIds.length) {
      throw new Error("PLAYER_NOT_FOUND");
    }
  }

  private async validateTeamPlayersAvailability(
    eventId: number,
    playerAId: number,
    playerBId: number,
    excludeTeamId?: number,
    executor: DbExecutor = db,
  ): Promise<void> {
    const playersToCheck = Array.from(new Set([playerAId, playerBId]));
    if (playersToCheck.length === 0) return;

    const playerConditions: any[] = [];
    for (const playerId of playersToCheck) {
      playerConditions.push(eq(teams.playerAId, playerId));
      playerConditions.push(eq(teams.playerBId, playerId));
    }

    const whereClause = and(
      eq(teams.eventId, eventId),
      playerConditions.length > 1 ? or(...playerConditions)! : playerConditions[0],
    );

    const possibleConflicts = await executor.select().from(teams).where(whereClause);
    const conflicts = typeof excludeTeamId === "number"
      ? possibleConflicts.filter((team) => team.id !== excludeTeamId)
      : possibleConflicts;

    if (conflicts.length > 0) {
      throw new Error("PLAYER_ALREADY_ASSIGNED");
    }
  }

  private async awardRankingForCompletedEvent(
    eventId: number,
    seasonYear: number,
    category: string,
    eventTeams: Team[],
    eventResults: NonstopResult[],
    opts: { nonstopCourts?: number | null; nonstopRounds?: number | null },
    executor: DbExecutor = db,
  ): Promise<void> {
    const normalizedCategory = this.normalizeNonstopCategory(category);
    const categoryKey = this.categoryKey(normalizedCategory);
    const teamPlayers = new Map<number, number[]>();
    const participatingPlayers = new Set<number>();

    for (const team of eventTeams) {
      const playerIds = this.getTeamPlayerIds(team);
      teamPlayers.set(team.id, playerIds);
      for (const playerId of playerIds) {
        participatingPlayers.add(playerId);
      }
    }

    for (const playerId of Array.from(participatingPlayers)) {
      await this.createRankingEntry(
        {
          playerId,
          seasonYear,
          category: normalizedCategory,
          eventId,
          round: null,
          points: RANKING_PARTICIPATION_POINTS,
          reason: "participation",
          reasonKey: `nonstop:${eventId}:cat:${categoryKey}:participation:player:${playerId}`,
          note: "Participação no Non Stop",
        },
        executor,
      );
    }

    const roundWinPoints = this.resolveRoundWinPoints(opts.nonstopCourts, opts.nonstopRounds);
    const roundWinPointsLabel = this.formatRankingPoints(roundWinPoints);

    for (const result of eventResults) {
      const hasPlayed = result.scoreA > 0 || result.scoreB > 0;
      if (!hasPlayed) continue;

      let winnerTeamId: number | null = null;
      if (result.scoreA > result.scoreB) winnerTeamId = result.teamAId;
      if (result.scoreB > result.scoreA) winnerTeamId = result.teamBId;
      if (!winnerTeamId) continue;

      const winnerPlayers = teamPlayers.get(winnerTeamId) ?? [];
      for (const playerId of winnerPlayers) {
        await this.createRankingEntry(
          {
            playerId,
            seasonYear,
            category: normalizedCategory,
            eventId,
            round: result.round,
            points: roundWinPoints,
            reason: "round_win",
            reasonKey: `nonstop:${eventId}:cat:${categoryKey}:round:${result.round}:court:${result.court}:win:player:${playerId}`,
            note: `Vitória na ronda ${result.round} (+${roundWinPointsLabel})`,
          },
          executor,
        );
      }
    }
  }

  private async getOrCreateActiveEvent(executor: DbExecutor = db): Promise<NonstopEvent> {
    const active = await executor
      .select()
      .from(nonstopEvents)
      .where(eq(nonstopEvents.status, "active"))
      .orderBy(desc(nonstopEvents.id))
      .limit(1);

    if (active[0]) {
      const normalizedCategory = this.normalizeNonstopCategory((active[0] as any).category);
      const hasSameCategory = active[0].category === normalizedCategory;
      if (active[0].startedAt && hasSameCategory) return active[0];
      const [updated] = await executor
        .update(nonstopEvents)
        .set({
          startedAt: active[0].startedAt ?? getDefaultNonstopStartedAt(),
          category: normalizedCategory,
        })
        .where(eq(nonstopEvents.id, active[0].id))
        .returning();
      return updated ?? active[0];
    }

    const [created] = await executor
      .insert(nonstopEvents)
      .values({
        status: "active",
        startedAt: getDefaultNonstopStartedAt(),
        category: DEFAULT_NONSTOP_CATEGORY,
      })
      .returning();

    await executor.insert(nonstopTimer).values({ eventId: created.id }).onConflictDoNothing();
    return created;
  }

  private async ensureEventStarted(eventId: number, executor: DbExecutor = db): Promise<void> {
    await executor
      .update(nonstopEvents)
      .set({ startedAt: new Date() })
      .where(and(eq(nonstopEvents.id, eventId), sql`${nonstopEvents.startedAt} IS NULL`));
  }

  async getPlayers(filters?: { level?: string }): Promise<Player[]> {
    if (filters?.level && filters.level !== "all") {
      return await db.select().from(players).where(eq(players.level, filters.level));
    }
    return await db.select().from(players);
  }

  async getPlayersPaginated(filters?: { level?: string; search?: string; profileTags?: string[]; page?: number; pageSize?: number }): Promise<PlayersPage> {
    const requestedPage = Number.isFinite(filters?.page) ? Number(filters?.page) : 1;
    const requestedPageSize = Number.isFinite(filters?.pageSize) ? Number(filters?.pageSize) : 25;
    const page = Math.max(1, Math.trunc(requestedPage));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(requestedPageSize)));
    const search = (filters?.search ?? "").trim();
    const profileTags = (filters?.profileTags ?? []).map((tag) => tag.trim()).filter(Boolean);

    const conditions: any[] = [];
    if (filters?.level && filters.level !== "all") {
      conditions.push(eq(players.level, filters.level));
    }
    if (search) {
      conditions.push(or(ilike(players.name, `%${search}%`), ilike(players.phone, `%${search}%`))!);
    }
    if (profileTags.length > 0) {
      const profileConditions = profileTags.map((tag) =>
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(NULLIF(${players.profileTags}, ''), '[]')::jsonb) AS profile(value)
          WHERE profile.value = ${tag}
        )`,
      );
      conditions.push(profileConditions.length > 1 ? and(...profileConditions)! : profileConditions[0]);
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    const countQuery = whereClause
      ? db.select({ total: count() }).from(players).where(whereClause)
      : db.select({ total: count() }).from(players);
    const [{ total }] = await countQuery;

    const dataQuery = whereClause
      ? db.select().from(players).where(whereClause).orderBy(desc(players.id)).limit(pageSize).offset((page - 1) * pageSize)
      : db.select().from(players).orderBy(desc(players.id)).limit(pageSize).offset((page - 1) * pageSize);
    const items = await dataQuery;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { items, total, page, pageSize, totalPages };
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const [player] = await db.insert(players).values(insertPlayer).returning();
    return player;
  }

  async updatePlayer(id: number, update: UpdatePlayerRequest): Promise<Player> {
    const [player] = await db.update(players).set(update).where(eq(players.id, id)).returning();
    return player;
  }

  async deletePlayer(id: number): Promise<void> {
    await db.delete(players).where(eq(players.id, id));
  }

  async getCurrentNonstopEvent(): Promise<NonstopEvent> {
    return this.getOrCreateActiveEvent();
  }

  async listNonstopEvents(filters?: { from?: Date; to?: Date }): Promise<NonstopEventSummary[]> {
    const conditions: any[] = [];
    const eventDate = sql`COALESCE(${nonstopEvents.startedAt}, ${nonstopEvents.createdAt})`;
    if (filters?.from) conditions.push(sql`${eventDate} >= ${filters.from}`);
    if (filters?.to) conditions.push(sql`${eventDate} < ${filters.to}`);
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const rows = where
      ? await db.select().from(nonstopEvents).where(where).orderBy(desc(eventDate))
      : await db.select().from(nonstopEvents).orderBy(desc(eventDate));
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      label: row.label,
      category: this.normalizeNonstopCategory((row as any).category),
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));
  }

  async getNonstopEventById(id: number): Promise<NonstopEvent | null> {
    const [event] = await db.select().from(nonstopEvents).where(eq(nonstopEvents.id, id));
    if (!event) return null;
    const normalizedCategory = this.normalizeNonstopCategory((event as any).category);
    if (event.category === normalizedCategory) return event;
    const [updated] = await db
      .update(nonstopEvents)
      .set({ category: normalizedCategory })
      .where(eq(nonstopEvents.id, id))
      .returning();
    return updated ?? { ...event, category: normalizedCategory };
  }

  async updateNonstopEventMetadata(
    id: number,
    update: { label?: string | null; startedAt?: Date | null; category?: string | null },
  ): Promise<NonstopEvent | null> {
    const values: Partial<Pick<NonstopEvent, "label" | "startedAt" | "category">> = {};
    if ("label" in update) values.label = update.label?.trim() || null;
    if ("startedAt" in update) values.startedAt = update.startedAt ?? null;
    if ("category" in update && update.category !== undefined) {
      values.category = this.normalizeNonstopCategory(update.category);
    }

    if (Object.keys(values).length === 0) {
      return this.getNonstopEventById(id);
    }

    return await db.transaction(async (tx) => {
      const [event] = await tx
        .update(nonstopEvents)
        .set(values)
        .where(eq(nonstopEvents.id, id))
        .returning();

      if (!event) return null;

      if (values.category) {
        await tx
          .update(rankingEntries)
          .set({ category: values.category })
          .where(eq(rankingEntries.eventId, id));
      }

      return event;
    });
  }

  async getNonstopEventDetails(id: number): Promise<NonstopEventDetails | null> {
    const event = await this.getNonstopEventById(id);
    if (!event) return null;
    const [eventTeams, eventResults, eventTimer] = await Promise.all([
      db.select().from(teams).where(eq(teams.eventId, id)),
      db.select().from(nonstopResults).where(eq(nonstopResults.eventId, id)),
      (async () => {
        const [timer] = await db.select().from(nonstopTimer).where(eq(nonstopTimer.eventId, id));
        if (timer) return timer;
        return {
          id: 0,
          eventId: id,
          timerState: "idle",
          isActive: 0,
          round: 1,
          timeLeft: 0,
          phaseEndsAt: null,
          updatedAt: new Date(),
        } satisfies NonstopTimer;
      })(),
    ]);

    let snapshot: any | null = null;
    if (event.snapshot) {
      try {
        snapshot = JSON.parse(event.snapshot);
      } catch {
        snapshot = null;
      }
    }

    return { event, teams: eventTeams, results: eventResults, timer: eventTimer, snapshot };
  }

  async deleteNonstopEvent(id: number): Promise<{ deletedEventId: number; deletedRankingEntries: number }> {
    return await db.transaction(async (tx) => {
      const [existingEvent] = await tx
        .select({
          id: nonstopEvents.id,
          status: nonstopEvents.status,
        })
        .from(nonstopEvents)
        .where(eq(nonstopEvents.id, id))
        .limit(1);

      if (!existingEvent) {
        throw new Error("EVENT_NOT_FOUND");
      }

      if (existingEvent.status === "active") {
        throw new Error("ACTIVE_EVENT_DELETE_NOT_ALLOWED");
      }

      const deletedRankingEntries = await tx
        .delete(rankingEntries)
        .where(eq(rankingEntries.eventId, id))
        .returning({ id: rankingEntries.id });

      await tx.delete(nonstopResults).where(eq(nonstopResults.eventId, id));
      await tx.delete(teams).where(eq(teams.eventId, id));
      await tx.delete(nonstopTimer).where(eq(nonstopTimer.eventId, id));
      const deletedEvents = await tx
        .delete(nonstopEvents)
        .where(eq(nonstopEvents.id, id))
        .returning({ id: nonstopEvents.id });

      if (deletedEvents.length === 0) {
        throw new Error("EVENT_NOT_FOUND");
      }

      return {
        deletedEventId: id,
        deletedRankingEntries: deletedRankingEntries.length,
      };
    });
  }

  async finalizeAndStartNonstop(opts?: { label?: string; userEmail?: string | null }): Promise<{ completedEventId: number; newEvent: NonstopEvent }> {
    const result = await db.transaction(async (tx) => {
      const activeEvent = await this.getOrCreateActiveEvent(tx as unknown as DbExecutor);
      const [eventTeams, eventResults, eventTimer, appSettings] = await Promise.all([
        tx.select().from(teams).where(eq(teams.eventId, activeEvent.id)),
        tx.select().from(nonstopResults).where(eq(nonstopResults.eventId, activeEvent.id)),
        (async () => {
          const [timer] = await tx.select().from(nonstopTimer).where(eq(nonstopTimer.eventId, activeEvent.id));
          return timer ?? {
            id: 0,
            eventId: activeEvent.id,
            timerState: "idle",
            isActive: 0,
            round: 1,
            timeLeft: 0,
            phaseEndsAt: null,
            updatedAt: new Date(),
          };
        })(),
        this.getSettings(),
      ]);

      const standings = computeStandings(
        eventTeams,
        eventResults,
        (appSettings.tieBreaker === "diff" ? "diff" : "direct"),
        appSettings.nonstopRounds ?? 5,
      );
      const configuredCategories = this.parseNonstopCategories(appSettings.nonstopCategories);
      const activeCategory = this.normalizeNonstopCategory(activeEvent.category);
      const eventCategory = configuredCategories.includes(activeCategory)
        ? activeCategory
        : configuredCategories[0];

      const snapshot = JSON.stringify({
        finalizedAt: new Date().toISOString(),
        category: eventCategory,
        teams: eventTeams,
        results: eventResults,
        timer: eventTimer,
        settings: {
          tieBreaker: appSettings.tieBreaker,
          nonstopRounds: appSettings.nonstopRounds,
          nonstopCourts: appSettings.nonstopCourts,
          gameTime: appSettings.gameTime,
          warmupTime: appSettings.warmupTime,
          restTime: appSettings.restTime,
        },
        standings,
      });
      const seasonYear = this.getSeasonYearFromEvent(activeEvent);

      await this.awardRankingForCompletedEvent(
        activeEvent.id,
        seasonYear,
        eventCategory,
        eventTeams,
        eventResults,
        {
          nonstopCourts: appSettings.nonstopCourts,
          nonstopRounds: appSettings.nonstopRounds,
        },
        tx as unknown as DbExecutor,
      );

      await tx
        .update(nonstopEvents)
        .set({
          status: "completed",
          completedAt: new Date(),
          label: opts?.label ?? activeEvent.label,
          category: eventCategory,
          finalizedBy: opts?.userEmail ?? null,
          snapshot,
        })
        .where(eq(nonstopEvents.id, activeEvent.id));

      const [newEvent] = await tx
        .insert(nonstopEvents)
        .values({
          status: "active",
          startedAt: getDefaultNonstopStartedAt(),
          category: eventCategory,
          createdBy: opts?.userEmail ?? null,
        })
        .returning();

      await tx.insert(nonstopTimer).values({ eventId: newEvent.id });
      return { completedEventId: activeEvent.id, newEvent };
    });
    await this.purgeOldNonstopEvents(90);
    await this.pruneOldRankingSeasons();
    return result;
  }

  async purgeOldNonstopEvents(retentionDays = 90): Promise<number> {
    const [oldEvents] = await Promise.all([
      db
        .select({ id: nonstopEvents.id })
        .from(nonstopEvents)
        .where(
          and(
            inArray(nonstopEvents.status, ["completed", "cancelled"] as NonstopEventStatus[]),
            sql`COALESCE(${nonstopEvents.completedAt}, ${nonstopEvents.createdAt}) < NOW() - (${retentionDays} * INTERVAL '1 day')`,
          ),
        ),
    ]);

    const ids = oldEvents.map((row) => row.id);
    if (ids.length === 0) return 0;

    await db.delete(nonstopResults).where(inArray(nonstopResults.eventId, ids));
    await db.delete(teams).where(inArray(teams.eventId, ids));
    await db.delete(nonstopTimer).where(inArray(nonstopTimer.eventId, ids));
    await db.delete(nonstopEvents).where(inArray(nonstopEvents.id, ids));
    return ids.length;
  }

  async getTeams(eventId?: number): Promise<Team[]> {
    const active = eventId ?? (await this.getOrCreateActiveEvent()).id;
    return await db.select().from(teams).where(eq(teams.eventId, active));
  }

  async createTeam(insertTeam: InsertTeam): Promise<Team> {
    const active = await this.getOrCreateActiveEvent();
    await this.validateTeamPlayersExist(
      insertTeam.playerAId,
      insertTeam.playerBId,
    );
    await this.validateTeamPlayersAvailability(
      active.id,
      insertTeam.playerAId,
      insertTeam.playerBId,
    );
    const [team] = await db.insert(teams).values({ ...insertTeam, eventId: active.id }).returning();
    return team;
  }

  async updateTeam(id: number, update: InsertTeam): Promise<Team> {
    const active = await this.getOrCreateActiveEvent();
    await this.validateTeamPlayersExist(
      update.playerAId,
      update.playerBId,
    );
    await this.validateTeamPlayersAvailability(
      active.id,
      update.playerAId,
      update.playerBId,
      id,
    );
    const [team] = await db
      .update(teams)
      .set(update)
      .where(and(eq(teams.id, id), eq(teams.eventId, active.id)))
      .returning();
    return team;
  }

  async deleteTeam(id: number): Promise<void> {
    const active = await this.getOrCreateActiveEvent();
    await db.delete(nonstopResults).where(and(eq(nonstopResults.eventId, active.id), or(eq(nonstopResults.teamAId, id), eq(nonstopResults.teamBId, id))));
    await db.delete(teams).where(and(eq(teams.id, id), eq(teams.eventId, active.id)));
  }

  async getResults(eventId?: number): Promise<NonstopResult[]> {
    const active = eventId ?? (await this.getOrCreateActiveEvent()).id;
    return await db.select().from(nonstopResults).where(eq(nonstopResults.eventId, active));
  }

  private async validateResultTeamsForActiveEvent(
    eventId: number,
    teamAId: number,
    teamBId: number,
    executor: DbExecutor = db,
  ): Promise<void> {
    if (teamAId === teamBId) {
      throw new Error("RESULT_SAME_TEAM");
    }

    const teamIds = Array.from(new Set([teamAId, teamBId]));
    const existingTeams = await executor
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), inArray(teams.id, teamIds)));

    if (existingTeams.length !== 2) {
      throw new Error("RESULT_TEAM_NOT_IN_EVENT");
    }
  }

  async createOrUpdateResult(insertResult: InsertNonstopResult): Promise<NonstopResult> {
    const active = await this.getOrCreateActiveEvent();
    const round = insertResult.round ?? 1;
    const court = insertResult.court ?? 1;
    await this.validateResultTeamsForActiveEvent(
      active.id,
      insertResult.teamAId,
      insertResult.teamBId,
    );

    const [saved] = await db
      .insert(nonstopResults)
      .values({ ...insertResult, eventId: active.id, round, court })
      .onConflictDoUpdate({
        target: [nonstopResults.eventId, nonstopResults.round, nonstopResults.court],
        set: {
          teamAId: insertResult.teamAId,
          teamBId: insertResult.teamBId,
          scoreA: insertResult.scoreA,
          scoreB: insertResult.scoreB,
        },
      })
      .returning();
    if (saved.scoreA > 0 || saved.scoreB > 0) {
      await this.ensureEventStarted(active.id);
    }
    return saved;
  }

  async clearResults(): Promise<void> {
    const active = await this.getOrCreateActiveEvent();
    await db.delete(nonstopResults).where(eq(nonstopResults.eventId, active.id));
  }

  async getSettings(): Promise<Settings> {
    const [existing] = await db.select().from(settings);
    if (!existing) {
      const [created] = await db.insert(settings).values({
        nonstopCategories: JSON.stringify([DEFAULT_NONSTOP_CATEGORY]),
      }).returning();
      return created;
    }
    const normalizedCategories = this.serializeNonstopCategories((existing as any).nonstopCategories);
    if (existing.nonstopCategories === normalizedCategories) {
      return existing;
    }
    const [updated] = await db
      .update(settings)
      .set({ nonstopCategories: normalizedCategories })
      .where(eq(settings.id, existing.id))
      .returning();
    return updated ?? { ...existing, nonstopCategories: normalizedCategories };
  }

  async updateSettings(update: Partial<InsertSettings>): Promise<Settings> {
    const current = await this.getSettings();
    const currentCategories = this.parseNonstopCategories(current.nonstopCategories);
    const normalizedUpdate: Partial<InsertSettings> = { ...update };
    let nextCategories = currentCategories;
    if ("nonstopCategories" in normalizedUpdate) {
      nextCategories = this.parseNonstopCategories(normalizedUpdate.nonstopCategories);
      normalizedUpdate.nonstopCategories = JSON.stringify(nextCategories);
    }
    const removedCategories = currentCategories.filter((category) => !nextCategories.includes(category));
    const fallbackCategory = nextCategories[0] ?? DEFAULT_NONSTOP_CATEGORY;

    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(settings)
        .set(normalizedUpdate)
        .where(eq(settings.id, current.id))
        .returning();

      if (removedCategories.length > 0) {
        const rankingWhere = removedCategories.length === 1
          ? eq(rankingEntries.category, removedCategories[0])
          : inArray(rankingEntries.category, removedCategories);
        await tx.delete(rankingEntries).where(rankingWhere);

        const eventWhere = removedCategories.length === 1
          ? eq(nonstopEvents.category, removedCategories[0])
          : inArray(nonstopEvents.category, removedCategories);
        await tx
          .update(nonstopEvents)
          .set({ category: fallbackCategory })
          .where(eventWhere);
      }

      return updated;
    });
  }

  async getNonstopTimer(eventId?: number): Promise<NonstopTimer> {
    const active = eventId ?? (await this.getOrCreateActiveEvent()).id;
    const [existing] = await db.select().from(nonstopTimer).where(eq(nonstopTimer.eventId, active));
    if (!existing) {
      const [created] = await db.insert(nonstopTimer).values({ eventId: active }).returning();
      return created;
    }
    return existing;
  }

  async updateNonstopTimer(update: Partial<InsertNonstopTimer>): Promise<NonstopTimer> {
    const activeEvent = await this.getOrCreateActiveEvent();
    const current = await this.getNonstopTimer(activeEvent.id);
    const [updated] = await db
      .update(nonstopTimer)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(eq(nonstopTimer.id, current.id))
      .returning();

    const becameActive = Boolean(update.isActive) && (update.timerState ?? updated.timerState) !== "idle";
    if (becameActive) {
      await this.ensureEventStarted(activeEvent.id);
    }
    return updated;
  }

  async resetNonstop(): Promise<void> {
    await this.finalizeAndStartNonstop();
  }

  async getRankingEntries(playerId?: number, seasonYear?: number, category?: string): Promise<RankingEntry[]> {
    const targetSeason = this.resolveSeasonYearInput(seasonYear);
    const shouldIncludeAllCategories = this.isAllCategoriesSelection(category);
    let targetCategory = DEFAULT_NONSTOP_CATEGORY;
    const conditions: any[] = [eq(rankingEntries.seasonYear, targetSeason)];

    if (!shouldIncludeAllCategories) {
      const categories = await this.getRankingCategories();
      const requestedCategory = this.normalizeNonstopCategory(category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      targetCategory = categories.includes(requestedCategory)
        ? requestedCategory
        : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      conditions.push(eq(rankingEntries.category, targetCategory));
    }

    if (typeof playerId === "number" && playerId > 0) {
      conditions.push(eq(rankingEntries.playerId, playerId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions)! : conditions[0];
    return await db
      .select()
      .from(rankingEntries)
      .where(whereClause)
      .orderBy(desc(rankingEntries.createdAt), desc(rankingEntries.id));
  }

  async getRankingLeaderboard(seasonYear?: number, category?: string): Promise<RankingLeaderboardRow[]> {
    const targetSeason = this.resolveSeasonYearInput(seasonYear);
    const shouldIncludeAllCategories = this.isAllCategoriesSelection(category);
    let targetCategory = DEFAULT_NONSTOP_CATEGORY;
    let rankingFilter = eq(rankingEntries.seasonYear, targetSeason);

    if (!shouldIncludeAllCategories) {
      const categories = await this.getRankingCategories();
      const requestedCategory = this.normalizeNonstopCategory(category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      targetCategory = categories.includes(requestedCategory)
        ? requestedCategory
        : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      rankingFilter = and(
        eq(rankingEntries.seasonYear, targetSeason),
        eq(rankingEntries.category, targetCategory),
      )!;
    }

    const [allPlayers, allEntries] = await Promise.all([
      db.select().from(players),
      db.select().from(rankingEntries).where(rankingFilter),
    ]);

    const totalsByPlayer = new Map<number, RankingLeaderboardRow>();
    for (const player of allPlayers) {
      totalsByPlayer.set(player.id, {
        playerId: player.id,
        name: player.name,
        level: player.level,
        totalPoints: 0,
        importedPoints: 0,
        participationCount: 0,
        roundWins: 0,
        lastEntryAt: null,
      });
    }

    for (const entry of allEntries) {
      const row = totalsByPlayer.get(entry.playerId);
      if (!row) continue;

      row.totalPoints += entry.points;
      if (entry.reason === "import") row.importedPoints += entry.points;
      if (entry.reason === "participation") row.participationCount += 1;
      if (entry.reason === "round_win") row.roundWins += 1;
      if (!row.lastEntryAt || entry.createdAt > row.lastEntryAt) {
        row.lastEntryAt = entry.createdAt;
      }
    }

    return Array.from(totalsByPlayer.values()).sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.name.localeCompare(b.name, "pt-PT", { sensitivity: "base" });
    });
  }

  async getRankingSeasons(): Promise<number[]> {
    await this.pruneOldRankingSeasons();
    const currentSeason = this.getCurrentSeasonYear();
    const rows = await db
      .selectDistinct({ seasonYear: rankingEntries.seasonYear })
      .from(rankingEntries)
      .where(sql`${rankingEntries.seasonYear} IS NOT NULL`)
      .orderBy(desc(rankingEntries.seasonYear));

    const seasons = new Set<number>([currentSeason]);

    for (const row of rows) {
      if (typeof row.seasonYear === "number") {
        seasons.add(row.seasonYear);
      }
    }

    return Array.from(seasons).sort((a, b) => b - a);
  }

  async getRankingCategories(): Promise<string[]> {
    const appSettings = await this.getSettings();
    const configured = this.parseNonstopCategories(appSettings.nonstopCategories);
    const [entryRows, eventRows] = await Promise.all([
      db
        .selectDistinct({ category: rankingEntries.category })
        .from(rankingEntries)
        .where(sql`${rankingEntries.category} IS NOT NULL AND BTRIM(${rankingEntries.category}) <> ''`),
      db
        .selectDistinct({ category: nonstopEvents.category })
        .from(nonstopEvents)
        .where(sql`${nonstopEvents.category} IS NOT NULL AND BTRIM(${nonstopEvents.category}) <> ''`),
    ]);

    const configuredSet = new Set(configured);
    const discovered = new Set<string>();

    for (const row of entryRows) {
      discovered.add(this.normalizeNonstopCategory(row.category));
    }
    for (const row of eventRows) {
      discovered.add(this.normalizeNonstopCategory(row.category));
    }

    const extras = Array.from(discovered)
      .filter((category) => !configuredSet.has(category))
      .sort((a, b) => a.localeCompare(b, "pt-PT", { sensitivity: "base" }));

    return [...configured, ...extras];
  }

  async getRankingHistory(opts?: { category?: string; limitSeasons?: number }): Promise<RankingSeasonHistoryRow[]> {
    const categories = await this.getRankingCategories();
    const shouldIncludeAllCategories = this.isAllCategoriesSelection(opts?.category);
    let targetCategory = RANKING_ALL_CATEGORIES_TOKEN;

    if (!shouldIncludeAllCategories) {
      const requestedCategory = this.normalizeNonstopCategory(opts?.category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      targetCategory = categories.includes(requestedCategory)
        ? requestedCategory
        : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    }
    const limitSeasons = Number.isFinite(opts?.limitSeasons)
      ? Math.min(5, Math.max(1, Math.trunc(Number(opts?.limitSeasons))))
      : 2;
    const seasons = (await this.getRankingSeasons()).slice(0, limitSeasons);
    const history: RankingSeasonHistoryRow[] = [];

    for (const season of seasons) {
      const leaderboard = await this.getRankingLeaderboard(season, targetCategory);
      const rowsWithPoints = leaderboard.filter((row) =>
        row.totalPoints !== 0 ||
        row.importedPoints !== 0 ||
        row.participationCount > 0 ||
        row.roundWins > 0,
      );

      let lastEntryAt: Date | null = null;
      for (const row of rowsWithPoints) {
        if (!row.lastEntryAt) continue;
        if (!lastEntryAt || row.lastEntryAt > lastEntryAt) {
          lastEntryAt = row.lastEntryAt;
        }
      }

      history.push({
        season,
        totalPlayers: rowsWithPoints.length,
        totalPoints: rowsWithPoints.reduce((sum, row) => sum + row.totalPoints, 0),
        importedPoints: rowsWithPoints.reduce((sum, row) => sum + row.importedPoints, 0),
        lastEntryAt,
        topPlayers: rowsWithPoints.slice(0, 3).map((row, index) => ({
          position: index + 1,
          playerId: row.playerId,
          name: row.name,
          level: row.level,
          totalPoints: row.totalPoints,
        })),
      });
    }

    return history;
  }

  async importRankingBasePoints(
    rows: RankingImportRow[],
    opts?: { batchLabel?: string; seasonYear?: number; category?: string; userEmail?: string | null },
  ): Promise<number> {
    const cleanRows = rows
      .filter((row) => Number.isInteger(row.playerId) && row.playerId > 0)
      .filter((row) => Number.isFinite(row.points))
      .map((row) => ({
        ...row,
        points: this.normalizeRankingPoints(row.points),
      }))
      .filter((row) => row.points !== 0);

    if (cleanRows.length === 0) return 0;

    const batchLabel = (opts?.batchLabel ?? "").trim() || new Date().toISOString();
    const seasonYear = this.resolveSeasonYearInput(opts?.seasonYear);
    const categories = await this.getRankingCategories();
    const requestedCategory = this.normalizeNonstopCategory(opts?.category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const category = categories.includes(requestedCategory)
      ? requestedCategory
      : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const categoryKey = this.categoryKey(category);
    const userEmail = (opts?.userEmail ?? "").trim();

    let inserted = 0;
    await db.transaction(async (tx) => {
      for (const row of cleanRows) {
        const wasInserted = await this.createRankingEntry(
          {
            playerId: row.playerId,
            seasonYear,
            category,
            eventId: null,
            round: null,
            points: row.points,
            reason: "import",
            reasonKey: `import:${seasonYear}:cat:${categoryKey}:${batchLabel}:player:${row.playerId}`,
            note: row.note || (userEmail ? `Importado por ${userEmail}` : "Importacao de pontuacao inicial"),
          },
          tx as unknown as DbExecutor,
        );

        if (wasInserted) inserted += 1;
      }
    });

    return inserted;
  }

  async getAuthorizedUsers(): Promise<AuthorizedUser[]> {
    return await db.select().from(authorizedUsers);
  }

  async getAuthorizedUserById(id: number): Promise<AuthorizedUser | null> {
    const [user] = await db.select().from(authorizedUsers).where(eq(authorizedUsers.id, id));
    return user || null;
  }

  async createAuthorizedUser(user: InsertAuthorizedUser): Promise<AuthorizedUser> {
    const [created] = await db.insert(authorizedUsers).values(user).returning();
    return created;
  }

  async deleteAuthorizedUser(id: number): Promise<void> {
    await db.delete(authorizedUsers).where(eq(authorizedUsers.id, id));
  }

  async isEmailAuthorized(email: string): Promise<boolean> {
    const users = await db.select().from(authorizedUsers);
    if (users.length === 0) return true;
    const normalizedEmail = email.toLowerCase();
    return users.some((u) => u.email.toLowerCase() === normalizedEmail);
  }

  async getAuthorizedUserByEmail(email: string): Promise<AuthorizedUser | null> {
    const normalizedEmail = email.toLowerCase();
    const [user] = await db.select().from(authorizedUsers).where(eq(authorizedUsers.email, normalizedEmail));
    return user || null;
  }

  async setUserPassword(id: number, hashedPassword: string): Promise<AuthorizedUser> {
    const [updated] = await db.update(authorizedUsers).set({ password: hashedPassword }).where(eq(authorizedUsers.id, id)).returning();
    return updated;
  }
}

const shouldUseLocalStorage =
  process.env.LOCAL_DATA_MODE?.trim().toLowerCase() === "mock" ||
  (!hasDatabase && process.env.NODE_ENV !== "production");

if (shouldUseLocalStorage) {
  console.warn("[startup] using in-memory local storage. Data resets when the dev server restarts.");
}

export const storage: IStorage = shouldUseLocalStorage
  ? new LocalStorage()
  : new DatabaseStorage();
