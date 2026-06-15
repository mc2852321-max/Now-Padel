import bcrypt from "bcryptjs";
import type {
  AuthorizedUser,
  InsertAuthorizedUser,
  InsertNonstopResult,
  InsertNonstopTimer,
  InsertPlayer,
  InsertSettings,
  InsertTeam,
  NonstopEvent,
  NonstopResult,
  NonstopTimer,
  Player,
  RankingEntry,
  Settings,
  Team,
  UpdatePlayerRequest,
} from "../shared/schema.js";
import type {
  IStorage,
  NonstopEventDetails,
  NonstopEventSummary,
  PlayersPage,
  RankingImportRow,
  RankingLeaderboardRow,
  RankingSeasonHistoryRow,
} from "./storage.js";
import {
  buildRankingSeasonOptions,
  getRankingSeasonForDate,
  normalizeRankingSeasonId,
  parseRankingSeasons,
  serializeRankingSeasons,
  type RankingSeasonOption,
} from "../shared/ranking-seasons.js";

const DEFAULT_NONSTOP_CATEGORY = "Non Stop";
const RANKING_ALL_CATEGORIES_TOKEN = "__all__";
const RANKING_PARTICIPATION_POINTS = 2;
const RANKING_MAX_WIN_POINTS_PER_EVENT = 15;

type BootstrapAuthUserLike = {
  email: string;
  name: string;
  password: string;
};

function getLisbonYear(dateLike?: Date | string | null): number {
  const value = dateLike ? new Date(dateLike) : new Date();
  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value;
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric" }).format(safeValue));
}

function normalizeRankingPoints(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveRoundWinPoints(nonstopRounds?: number | null): number {
  const rounds = Number.isFinite(nonstopRounds) ? Math.max(1, Number(nonstopRounds)) : 0;
  return rounds > 0 ? RANKING_MAX_WIN_POINTS_PER_EVENT / rounds : 3;
}

function parseBootstrapUsers(): BootstrapAuthUserLike[] {
  const raw = process.env.BOOTSTRAP_AUTH_USERS_JSON?.trim();
  if (!raw) {
    return [{ email: "admin@nowpadel.local", name: "Admin", password: "admin123" }];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        email: typeof item?.email === "string" ? item.email.trim().toLowerCase() : "",
        name: typeof item?.name === "string" ? item.name.trim() : "",
        password: typeof item?.password === "string" ? item.password : "",
      }))
      .filter((item) => item.email && item.password);
  } catch {
    return [];
  }
}

export class LocalStorage implements IStorage {
  private nextPlayerId = 5;
  private nextTeamId = 1;
  private nextResultId = 1;
  private nextEventId = 2;
  private nextTimerId = 2;
  private nextAuthorizedUserId = 1;
  private nextRankingEntryId = 1;

  private players: Player[] = [
    { id: 1, name: "Joao Silva", phone: "912345678", level: "M5", notes: "Excelente backhand", profileTags: "[]" },
    { id: 2, name: "Maria Santos", phone: "923456789", level: "F3", notes: "Precisa treinar o smash", profileTags: "[]" },
    { id: 3, name: "Pedro Costa", phone: "934567890", level: "M4", notes: "Jogador regular", profileTags: "[]" },
    { id: 4, name: "Ana Oliveira", phone: "961234567", level: "F6", notes: "Nivel de competicao", profileTags: "[]" },
  ];

  private teams: Team[] = [];
  private results: NonstopResult[] = [];
  private completedEvents: NonstopEvent[] = [];
  private completedTimers: NonstopTimer[] = [];
  private rankingEntries: RankingEntry[] = [];
  private authorizedUsers: AuthorizedUser[] = [];
  private event: NonstopEvent = {
    id: 1,
    status: "active",
    label: "Local",
    category: DEFAULT_NONSTOP_CATEGORY,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    finalizedBy: null,
    createdBy: "local",
    snapshot: null,
  };
  private timer: NonstopTimer = {
    id: 1,
    eventId: 1,
    timerState: "idle",
    isActive: 0,
    round: 1,
    timeLeft: 0,
    phaseEndsAt: null,
    updatedAt: new Date(),
  };
  private settings: Settings = {
    id: 1,
    clubName: "Now Padel & Fit",
    primaryColor: "#f97316",
    website: "https://nowpadel.pt",
    whatsappNotifications: 1,
    emailNotifications: 0,
    publicRegistration: 1,
    logo: null,
    nonstopCourts: 3,
    nonstopRounds: 5,
    gameTime: 20,
    warmupTime: 5,
    restTime: 2,
    startWarmupSound: "beep-low",
    startGameSound: "beep-high",
    endGameSound: "beep-low",
    finalSound: "beep-high",
    airHornDuration: 5,
    soundDurationTarget: "air-horn",
    soundDurationSeconds: 5,
    tieBreaker: "direct",
    playerProfileOptions: "[\"Academia\",\"Fecha jogos\",\"Non Stop\"]",
    nonstopCategories: "[\"Non Stop\"]",
    rankingSeasons: serializeRankingSeasons(undefined),
  };

  constructor() {
    for (const user of parseBootstrapUsers()) {
      this.authorizedUsers.push({
        id: this.nextAuthorizedUserId++,
        email: user.email,
        name: user.name || user.email,
        password: bcrypt.hashSync(user.password, 10),
        addedAt: new Date(),
      });
    }
  }

  private normalizeNonstopCategory(value: unknown, fallback = DEFAULT_NONSTOP_CATEGORY): string {
    const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!cleaned) return fallback;
    return cleaned.length <= 60 ? cleaned : cleaned.slice(0, 60).trim() || fallback;
  }

  private parseNonstopCategoriesFrom(raw: unknown): string[] {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        const categories = parsed
          .map((value) => this.normalizeNonstopCategory(value, ""))
          .filter(Boolean);
        if (categories.length > 0) return Array.from(new Set(categories));
      }
    } catch {
      // keep local mode forgiving when settings are edited by hand
    }
    return [DEFAULT_NONSTOP_CATEGORY];
  }

  private parseNonstopCategories(): string[] {
    return this.parseNonstopCategoriesFrom(this.settings.nonstopCategories);
  }

  private parseRankingSeasons() {
    return parseRankingSeasons(this.settings.rankingSeasons);
  }

  private getLisbonDateKey(dateLike: Date | string | null | undefined): string {
    const value = dateLike ? new Date(dateLike) : new Date();
    const safeDate = Number.isNaN(value.getTime()) ? new Date() : value;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(safeDate);
  }

  private getRankingSeasonIdForDate(dateLike: Date | string | null | undefined): number {
    return getRankingSeasonForDate(
      this.settings.rankingSeasons,
      this.getLisbonDateKey(dateLike),
      getLisbonYear(dateLike),
    ).id;
  }

  private categoryKey(category: string): string {
    return encodeURIComponent(this.normalizeNonstopCategory(category));
  }

  private createRankingEntry(entry: Omit<RankingEntry, "id" | "createdAt">): boolean {
    if (this.rankingEntries.some((existing) => existing.reasonKey === entry.reasonKey)) {
      return false;
    }

    this.rankingEntries.push({
      ...entry,
      id: this.nextRankingEntryId++,
      createdAt: new Date(),
    });
    return true;
  }

  private awardRankingForCurrentEvent(
    eventId: number,
    seasonYear: number,
    category: string,
    eventTeams: Team[],
    eventResults: NonstopResult[],
  ): void {
    const normalizedCategory = this.normalizeNonstopCategory(category);
    const categoryKey = this.categoryKey(normalizedCategory);
    const teamPlayers = new Map<number, number[]>();
    const participatingPlayers = new Set<number>();

    for (const team of eventTeams) {
      const playerIds = [team.playerAId, team.playerBId]
        .filter((id): id is number => typeof id === "number" && id > 0);
      const uniquePlayerIds = Array.from(new Set(playerIds));
      teamPlayers.set(team.id, uniquePlayerIds);
      for (const playerId of uniquePlayerIds) {
        participatingPlayers.add(playerId);
      }
    }

    for (const playerId of Array.from(participatingPlayers)) {
      this.createRankingEntry({
        playerId,
        seasonYear,
        category: normalizedCategory,
        eventId,
        round: null,
        points: RANKING_PARTICIPATION_POINTS,
        reason: "participation",
        reasonKey: `nonstop:${eventId}:cat:${categoryKey}:participation:player:${playerId}`,
        note: "Participacao no Non Stop",
      });
    }

    const roundWinPoints = resolveRoundWinPoints(this.settings.nonstopRounds);

    for (const result of eventResults) {
      const hasPlayed = result.scoreA > 0 || result.scoreB > 0;
      if (!hasPlayed) continue;

      let winnerTeamId: number | null = null;
      if (result.scoreA > result.scoreB) winnerTeamId = result.teamAId;
      if (result.scoreB > result.scoreA) winnerTeamId = result.teamBId;
      if (!winnerTeamId) continue;

      for (const playerId of teamPlayers.get(winnerTeamId) ?? []) {
        this.createRankingEntry({
          playerId,
          seasonYear,
          category: normalizedCategory,
          eventId,
          round: result.round,
          points: roundWinPoints,
          reason: "round_win",
          reasonKey: `nonstop:${eventId}:cat:${categoryKey}:round:${result.round}:court:${result.court}:win:player:${playerId}`,
          note: `Vitoria na ronda ${result.round}`,
        });
      }
    }
  }

  async getPlayers(filters?: { level?: string }): Promise<Player[]> {
    if (!filters?.level) return [...this.players];
    return this.players.filter((player) => player.level === filters.level);
  }

  async getPlayersPaginated(filters?: { level?: string; search?: string; profileTags?: string[]; page?: number; pageSize?: number }): Promise<PlayersPage> {
    let rows = await this.getPlayers({ level: filters?.level });
    const search = filters?.search?.trim().toLowerCase();
    if (search) {
      rows = rows.filter((player) =>
        player.name.toLowerCase().includes(search) ||
        player.phone.toLowerCase().includes(search),
      );
    }

    if (filters?.profileTags?.length) {
      rows = rows.filter((player) => {
        try {
          const tags = JSON.parse(player.profileTags);
          return Array.isArray(tags) && filters.profileTags!.every((tag) => tags.includes(tag));
        } catch {
          return false;
        }
      });
    }

    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.max(1, filters?.pageSize ?? 25);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    return {
      items: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async createPlayer(player: InsertPlayer): Promise<Player> {
    const created: Player = {
      id: this.nextPlayerId++,
      name: player.name,
      phone: player.phone,
      level: player.level,
      notes: player.notes ?? null,
      profileTags: player.profileTags ?? "[]",
    };
    this.players.push(created);
    return created;
  }

  async updatePlayer(id: number, update: UpdatePlayerRequest): Promise<Player> {
    const index = this.players.findIndex((player) => player.id === id);
    if (index === -1) throw new Error("Player not found");
    this.players[index] = { ...this.players[index], ...update };
    return this.players[index];
  }

  async deletePlayer(id: number): Promise<void> {
    this.players = this.players.filter((player) => player.id !== id);
  }

  async getCurrentNonstopEvent(): Promise<NonstopEvent> {
    return this.event;
  }

  async listNonstopEvents(): Promise<NonstopEventSummary[]> {
    return [this.event, ...this.completedEvents]
      .sort((a, b) => {
        const aTime = new Date(a.startedAt ?? a.createdAt).getTime();
        const bTime = new Date(b.startedAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }

  async getNonstopEventById(id: number): Promise<NonstopEvent | null> {
    if (id === this.event.id) return this.event;
    return this.completedEvents.find((event) => event.id === id) ?? null;
  }

  async updateNonstopEventMetadata(id: number, update: { label?: string | null; startedAt?: Date | null; category?: string | null }): Promise<NonstopEvent | null> {
    const nextValues = (event: NonstopEvent): NonstopEvent => ({
      ...event,
      label: update.label ?? event.label,
      startedAt: update.startedAt ?? event.startedAt,
      category: update.category?.trim() || event.category || DEFAULT_NONSTOP_CATEGORY,
    });

    if (id === this.event.id) {
      this.event = nextValues(this.event);
      return this.event;
    }

    const index = this.completedEvents.findIndex((event) => event.id === id);
    if (index === -1) return null;
    this.completedEvents[index] = nextValues(this.completedEvents[index]);
    if (update.category) {
      const category = this.normalizeNonstopCategory(update.category);
      this.rankingEntries = this.rankingEntries.map((entry) =>
        entry.eventId === id ? { ...entry, category } : entry
      );
    }
    return this.completedEvents[index];
  }

  async getNonstopEventDetails(id: number): Promise<NonstopEventDetails | null> {
    const event = await this.getNonstopEventById(id);
    if (!event) return null;
    let snapshot: any | null = null;
    if (event.snapshot) {
      try {
        snapshot = JSON.parse(event.snapshot);
      } catch {
        snapshot = null;
      }
    }
    return {
      event,
      teams: this.teams.filter((team) => team.eventId === id),
      results: this.results.filter((result) => result.eventId === id),
      timer: await this.getNonstopTimer(id),
      snapshot,
    };
  }

  async deleteNonstopEvent(id: number): Promise<{ deletedEventId: number; deletedRankingEntries: number }> {
    if (id === this.event.id) {
      throw new Error("ACTIVE_EVENT_DELETE_NOT_ALLOWED");
    }
    const beforeEvents = this.completedEvents.length;
    this.completedEvents = this.completedEvents.filter((event) => event.id !== id);
    if (this.completedEvents.length === beforeEvents) {
      throw new Error("EVENT_NOT_FOUND");
    }
    this.teams = this.teams.filter((team) => team.eventId !== id);
    this.results = this.results.filter((result) => result.eventId !== id);
    this.completedTimers = this.completedTimers.filter((timer) => timer.eventId !== id);
    const beforeRankingEntries = this.rankingEntries.length;
    this.rankingEntries = this.rankingEntries.filter((entry) => entry.eventId !== id);
    return {
      deletedEventId: id,
      deletedRankingEntries: beforeRankingEntries - this.rankingEntries.length,
    };
  }

  async finalizeAndStartNonstop(opts?: { label?: string; userEmail?: string | null }): Promise<{ completedEventId: number; newEvent: NonstopEvent }> {
    const completedEventId = this.event.id;
    const category = this.normalizeNonstopCategory(this.event.category);
    const eventTeams = this.teams.filter((team) => team.eventId === completedEventId);
    const eventResults = this.results.filter((result) => result.eventId === completedEventId);
    this.awardRankingForCurrentEvent(
      completedEventId,
      this.getRankingSeasonIdForDate(this.event.startedAt ?? this.event.createdAt),
      category,
      eventTeams,
      eventResults,
    );
    const completedAt = new Date();
    const completedEvent: NonstopEvent = {
      ...this.event,
      status: "completed",
      label: opts?.label ?? this.event.label,
      category,
      completedAt,
      finalizedBy: opts?.userEmail ?? null,
      snapshot: JSON.stringify({
        finalizedAt: completedAt.toISOString(),
        category,
        teams: eventTeams,
        results: eventResults,
        timer: this.timer,
        settings: {
          tieBreaker: this.settings.tieBreaker,
          nonstopRounds: this.settings.nonstopRounds,
          nonstopCourts: this.settings.nonstopCourts,
          gameTime: this.settings.gameTime,
          warmupTime: this.settings.warmupTime,
          restTime: this.settings.restTime,
        },
      }),
    };
    this.completedEvents = [
      completedEvent,
      ...this.completedEvents.filter((event) => event.id !== completedEventId),
    ];
    this.completedTimers = [
      { ...this.timer, eventId: completedEventId, updatedAt: new Date() },
      ...this.completedTimers.filter((timer) => timer.eventId !== completedEventId),
    ];
    this.event = {
      id: this.nextEventId++,
      status: "active",
      label: opts?.label ?? "Local",
      category,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      finalizedBy: null,
      createdBy: opts?.userEmail ?? "local",
      snapshot: null,
    };
    this.timer = { id: this.nextTimerId++, eventId: this.event.id, timerState: "idle", isActive: 0, round: 1, timeLeft: 0, phaseEndsAt: null, updatedAt: new Date() };
    return { completedEventId, newEvent: this.event };
  }

  async purgeOldNonstopEvents(): Promise<number> {
    return 0;
  }

  async getTeams(eventId?: number): Promise<Team[]> {
    const targetEventId = eventId ?? this.event.id;
    return this.teams.filter((team) => team.eventId === targetEventId);
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const created: Team = {
      id: this.nextTeamId++,
      name: team.name,
      eventId: this.event.id,
      playerAId: team.playerAId,
      playerBId: team.playerBId,
    };
    this.teams.push(created);
    return created;
  }

  async updateTeam(id: number, update: InsertTeam): Promise<Team> {
    const index = this.teams.findIndex((team) => team.id === id);
    if (index === -1) throw new Error("Team not found");
    this.teams[index] = { ...this.teams[index], ...update };
    return this.teams[index];
  }

  async deleteTeam(id: number): Promise<void> {
    this.teams = this.teams.filter((team) => team.id !== id);
  }

  async getResults(eventId?: number): Promise<NonstopResult[]> {
    const targetEventId = eventId ?? this.event.id;
    return this.results.filter((result) => result.eventId === targetEventId);
  }

  async createOrUpdateResult(result: InsertNonstopResult): Promise<NonstopResult> {
    const eventId = result.eventId ?? this.event.id;
    const existingIndex = this.results.findIndex((row) =>
      row.eventId === eventId &&
      row.round === result.round &&
      row.court === result.court,
    );
    const next: NonstopResult = {
      id: existingIndex >= 0 ? this.results[existingIndex].id : this.nextResultId++,
      eventId,
      teamAId: result.teamAId,
      teamBId: result.teamBId,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      round: result.round ?? 1,
      court: result.court ?? 1,
      playedAt: new Date(),
    };

    if (existingIndex >= 0) this.results[existingIndex] = next;
    else this.results.push(next);
    return next;
  }

  async clearResults(): Promise<void> {
    this.results = this.results.filter((result) => result.eventId !== this.event.id);
  }

  async getSettings(): Promise<Settings> {
    return this.settings;
  }

  async updateSettings(update: Partial<InsertSettings>): Promise<Settings> {
    this.settings = {
      ...this.settings,
      ...update,
      nonstopCategories: update.nonstopCategories !== undefined
        ? JSON.stringify(this.parseNonstopCategoriesFrom(update.nonstopCategories))
        : this.settings.nonstopCategories,
      rankingSeasons: update.rankingSeasons !== undefined
        ? serializeRankingSeasons(update.rankingSeasons)
        : this.settings.rankingSeasons,
    };
    return this.settings;
  }

  async getNonstopTimer(eventId?: number): Promise<NonstopTimer> {
    if (eventId != null && eventId !== this.event.id) {
      return this.completedTimers.find((timer) => timer.eventId === eventId) ?? {
        id: 0,
        eventId,
        timerState: "idle",
        isActive: 0,
        round: 1,
        timeLeft: 0,
        phaseEndsAt: null,
        updatedAt: new Date(),
      };
    }
    return this.timer;
  }

  async updateNonstopTimer(update: Partial<InsertNonstopTimer>): Promise<NonstopTimer> {
    this.timer = {
      ...this.timer,
      ...update,
      updatedAt: new Date(),
    };
    return this.timer;
  }

  async resetNonstop(): Promise<void> {
    this.teams = this.teams.filter((team) => team.eventId !== this.event.id);
    this.results = this.results.filter((result) => result.eventId !== this.event.id);
    this.timer = { ...this.timer, timerState: "idle", isActive: 0, round: 1, timeLeft: 0, phaseEndsAt: null, updatedAt: new Date() };
  }

  async getRankingLeaderboard(seasonYear?: number, category?: string): Promise<RankingLeaderboardRow[]> {
    const targetSeason = normalizeRankingSeasonId(seasonYear) ?? await this.getCurrentRankingSeasonId();
    const includeAllCategories = typeof category === "string" && category.trim().toLowerCase() === RANKING_ALL_CATEGORIES_TOKEN;
    const categories = await this.getRankingCategories();
    const requestedCategory = this.normalizeNonstopCategory(category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const targetCategory = categories.includes(requestedCategory)
      ? requestedCategory
      : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);

    const entries = this.rankingEntries.filter((entry) =>
      entry.seasonYear === targetSeason &&
      (includeAllCategories || entry.category === targetCategory)
    );

    const totalsByPlayer = new Map<number, RankingLeaderboardRow>();
    for (const player of this.players) {
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

    for (const entry of entries) {
      const row = totalsByPlayer.get(entry.playerId);
      if (!row) continue;

      row.totalPoints = normalizeRankingPoints(row.totalPoints + entry.points);
      if (entry.reason === "import") row.importedPoints = normalizeRankingPoints(row.importedPoints + entry.points);
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

  async getRankingEntries(playerId?: number, seasonYear?: number, category?: string): Promise<RankingEntry[]> {
    const targetSeason = normalizeRankingSeasonId(seasonYear) ?? await this.getCurrentRankingSeasonId();
    const includeAllCategories = typeof category === "string" && category.trim().toLowerCase() === RANKING_ALL_CATEGORIES_TOKEN;
    const categories = await this.getRankingCategories();
    const requestedCategory = this.normalizeNonstopCategory(category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const targetCategory = categories.includes(requestedCategory)
      ? requestedCategory
      : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);

    return this.rankingEntries
      .filter((entry) => entry.seasonYear === targetSeason)
      .filter((entry) => includeAllCategories || entry.category === targetCategory)
      .filter((entry) => !playerId || entry.playerId === playerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
  }

  async getRankingSeasons(): Promise<number[]> {
    const seasons = new Set<number>([
      await this.getCurrentRankingSeasonId(),
      ...this.parseRankingSeasons().map((season) => season.id),
    ]);
    for (const entry of this.rankingEntries) {
      const normalizedId = normalizeRankingSeasonId(entry.seasonYear);
      if (normalizedId) seasons.add(normalizedId);
    }
    return Array.from(seasons).sort((a, b) => b - a);
  }

  async getRankingSeasonOptions(): Promise<RankingSeasonOption[]> {
    const discovered = this.rankingEntries
      .map((entry) => normalizeRankingSeasonId(entry.seasonYear))
      .filter((id): id is number => Boolean(id));
    return buildRankingSeasonOptions(this.parseRankingSeasons(), discovered);
  }

  async getCurrentRankingSeasonId(dateLike?: Date | string | null): Promise<number> {
    return this.getRankingSeasonIdForDate(dateLike ?? new Date());
  }

  async getRankingCategories(): Promise<string[]> {
    const configured = this.parseNonstopCategories();
    const categorySet = new Set(configured);
    for (const entry of this.rankingEntries) {
      categorySet.add(this.normalizeNonstopCategory(entry.category));
    }
    if (this.event.category) {
      categorySet.add(this.normalizeNonstopCategory(this.event.category));
    }
    return Array.from(categorySet);
  }

  async getRankingHistory(opts?: { category?: string; limitSeasons?: number }): Promise<RankingSeasonHistoryRow[]> {
    const limitSeasons = Number.isFinite(opts?.limitSeasons)
      ? Math.min(5, Math.max(1, Math.trunc(Number(opts?.limitSeasons))))
      : 2;
    const today = this.getLisbonDateKey(new Date());
    const seasons = (await this.getRankingSeasonOptions())
      .filter((season) => season.startsAt <= today || !season.configured)
      .slice(0, limitSeasons)
      .map((season) => season.id);

    const includeAllCategories = typeof opts?.category === "string" && opts.category.trim().toLowerCase() === RANKING_ALL_CATEGORIES_TOKEN;
    const categories = await this.getRankingCategories();
    const requestedCategory = this.normalizeNonstopCategory(opts?.category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const targetCategory = includeAllCategories
      ? RANKING_ALL_CATEGORIES_TOKEN
      : categories.includes(requestedCategory)
        ? requestedCategory
        : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);

    const history: RankingSeasonHistoryRow[] = [];
    for (const season of seasons) {
      const leaderboard = await this.getRankingLeaderboard(season, targetCategory);
      const rowsWithPoints = leaderboard.filter((row) =>
        row.totalPoints !== 0 ||
        row.importedPoints !== 0 ||
        row.participationCount > 0 ||
        row.roundWins > 0,
      );
      const lastEntryAt = rowsWithPoints.reduce<Date | null>(
        (latest, row) => row.lastEntryAt && (!latest || row.lastEntryAt > latest) ? row.lastEntryAt : latest,
        null,
      );

      history.push({
        season,
        totalPlayers: rowsWithPoints.length,
        totalPoints: normalizeRankingPoints(rowsWithPoints.reduce((sum, row) => sum + row.totalPoints, 0)),
        importedPoints: normalizeRankingPoints(rowsWithPoints.reduce((sum, row) => sum + row.importedPoints, 0)),
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

  async importRankingBasePoints(rows: RankingImportRow[], opts?: { batchLabel?: string; seasonYear?: number; category?: string; userEmail?: string | null }): Promise<number> {
    const cleanRows = rows
      .filter((row) => Number.isInteger(row.playerId) && row.playerId > 0)
      .filter((row) => Number.isFinite(row.points))
      .map((row) => ({ ...row, points: normalizeRankingPoints(row.points) }))
      .filter((row) => row.points !== 0);
    if (cleanRows.length === 0) return 0;

    const seasonYear = normalizeRankingSeasonId(opts?.seasonYear) ?? await this.getCurrentRankingSeasonId();
    const categories = await this.getRankingCategories();
    const requestedCategory = this.normalizeNonstopCategory(opts?.category, categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const category = categories.includes(requestedCategory)
      ? requestedCategory
      : (categories[0] ?? DEFAULT_NONSTOP_CATEGORY);
    const categoryKey = this.categoryKey(category);
    const batchLabel = (opts?.batchLabel ?? "").trim() || new Date().toISOString();
    const userEmail = (opts?.userEmail ?? "").trim();
    let inserted = 0;

    for (const row of cleanRows) {
      const wasInserted = this.createRankingEntry({
        playerId: row.playerId,
        seasonYear,
        category,
        eventId: null,
        round: null,
        points: row.points,
        reason: "import",
        reasonKey: `import:${seasonYear}:cat:${categoryKey}:${batchLabel}:player:${row.playerId}`,
        note: row.note || (userEmail ? `Importado por ${userEmail}` : "Importacao de pontuacao inicial"),
      });
      if (wasInserted) inserted += 1;
    }

    return inserted;
  }

  async getAuthorizedUsers(): Promise<AuthorizedUser[]> {
    return this.authorizedUsers;
  }

  async getAuthorizedUserById(id: number): Promise<AuthorizedUser | null> {
    return this.authorizedUsers.find((user) => user.id === id) ?? null;
  }

  async createAuthorizedUser(user: InsertAuthorizedUser): Promise<AuthorizedUser> {
    const created: AuthorizedUser = {
      id: this.nextAuthorizedUserId++,
      email: user.email.toLowerCase(),
      name: user.name ?? null,
      password: null,
      addedAt: new Date(),
    };
    this.authorizedUsers.push(created);
    return created;
  }

  async deleteAuthorizedUser(id: number): Promise<void> {
    this.authorizedUsers = this.authorizedUsers.filter((user) => user.id !== id);
  }

  async isEmailAuthorized(email: string): Promise<boolean> {
    if (this.authorizedUsers.length === 0) return true;
    return this.authorizedUsers.some((user) => user.email.toLowerCase() === email.toLowerCase());
  }

  async getAuthorizedUserByEmail(email: string): Promise<AuthorizedUser | null> {
    return this.authorizedUsers.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async setUserPassword(id: number, hashedPassword: string): Promise<AuthorizedUser> {
    const user = await this.getAuthorizedUserById(id);
    if (!user) throw new Error("User not found");
    user.password = hashedPassword;
    return user;
  }
}
