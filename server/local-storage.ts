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
import type { IStorage, NonstopEventDetails, NonstopEventSummary, PlayersPage, RankingImportRow, RankingLeaderboardRow } from "./storage.js";

type BootstrapAuthUserLike = {
  email: string;
  name: string;
  password: string;
};

function getLisbonYear(): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric" }).format(new Date()));
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
  private nextAuthorizedUserId = 1;

  private players: Player[] = [
    { id: 1, name: "Joao Silva", phone: "912345678", level: "M5", notes: "Excelente backhand", profileTags: "[]" },
    { id: 2, name: "Maria Santos", phone: "923456789", level: "F3", notes: "Precisa treinar o smash", profileTags: "[]" },
    { id: 3, name: "Pedro Costa", phone: "934567890", level: "M4", notes: "Jogador regular", profileTags: "[]" },
    { id: 4, name: "Ana Oliveira", phone: "961234567", level: "F6", notes: "Nivel de competicao", profileTags: "[]" },
  ];

  private teams: Team[] = [];
  private results: NonstopResult[] = [];
  private authorizedUsers: AuthorizedUser[] = [];
  private event: NonstopEvent = {
    id: 1,
    status: "active",
    label: "Local",
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
    return [this.event];
  }

  async getNonstopEventById(id: number): Promise<NonstopEvent | null> {
    return id === this.event.id ? this.event : null;
  }

  async updateNonstopEventMetadata(id: number, update: { label?: string | null; startedAt?: Date | null }): Promise<NonstopEvent | null> {
    if (id !== this.event.id) return null;
    this.event = { ...this.event, label: update.label ?? this.event.label, startedAt: update.startedAt ?? this.event.startedAt };
    return this.event;
  }

  async getNonstopEventDetails(id: number): Promise<NonstopEventDetails | null> {
    if (id !== this.event.id) return null;
    return {
      event: this.event,
      teams: this.teams,
      results: this.results,
      timer: this.timer,
      snapshot: null,
    };
  }

  async finalizeAndStartNonstop(opts?: { label?: string; userEmail?: string | null }): Promise<{ completedEventId: number; newEvent: NonstopEvent }> {
    const completedEventId = this.event.id;
    this.event = {
      id: this.nextEventId++,
      status: "active",
      label: opts?.label ?? "Local",
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      finalizedBy: null,
      createdBy: opts?.userEmail ?? "local",
      snapshot: null,
    };
    this.timer = { ...this.timer, eventId: this.event.id, timerState: "idle", isActive: 0, round: 1, timeLeft: 0, phaseEndsAt: null, updatedAt: new Date() };
    this.teams = [];
    this.results = [];
    return { completedEventId, newEvent: this.event };
  }

  async purgeOldNonstopEvents(): Promise<number> {
    return 0;
  }

  async getTeams(eventId?: number): Promise<Team[]> {
    return this.teams.filter((team) => eventId == null || team.eventId === eventId);
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
    return this.results.filter((result) => eventId == null || result.eventId === eventId);
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
    this.results = [];
  }

  async getSettings(): Promise<Settings> {
    return this.settings;
  }

  async updateSettings(update: Partial<InsertSettings>): Promise<Settings> {
    this.settings = { ...this.settings, ...update };
    return this.settings;
  }

  async getNonstopTimer(): Promise<NonstopTimer> {
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
    this.teams = [];
    this.results = [];
    this.timer = { ...this.timer, timerState: "idle", isActive: 0, round: 1, timeLeft: 0, phaseEndsAt: null, updatedAt: new Date() };
  }

  async getRankingLeaderboard(): Promise<RankingLeaderboardRow[]> {
    return [];
  }

  async getRankingEntries(): Promise<RankingEntry[]> {
    return [];
  }

  async getRankingSeasons(): Promise<number[]> {
    return [getLisbonYear()];
  }

  async importRankingBasePoints(_rows: RankingImportRow[]): Promise<number> {
    return 0;
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
