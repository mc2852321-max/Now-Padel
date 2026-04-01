import { players, teams, nonstopResults, nonstopTimer, settings, authorizedUsers, type Player, type InsertPlayer, type UpdatePlayerRequest, type Team, type InsertTeam, type NonstopResult, type InsertNonstopResult, type NonstopTimer, type InsertNonstopTimer, type Settings, type InsertSettings, type AuthorizedUser, type InsertAuthorizedUser } from "../shared/schema.js";
import { db } from "./db.js";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";

export type PlayersPage = {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export interface IStorage {
  // Players
  getPlayers(filters?: { level?: string }): Promise<Player[]>;
  getPlayersPaginated(filters?: { level?: string; search?: string; page?: number; pageSize?: number }): Promise<PlayersPage>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(id: number, player: UpdatePlayerRequest): Promise<Player>;
  deletePlayer(id: number): Promise<void>;

  // Teams
  getTeams(): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: InsertTeam): Promise<Team>;
  deleteTeam(id: number): Promise<void>;

  // Results
  getResults(): Promise<NonstopResult[]>;
  createOrUpdateResult(result: InsertNonstopResult): Promise<NonstopResult>;
  clearResults(): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;
  getNonstopTimer(): Promise<NonstopTimer>;
  updateNonstopTimer(timer: Partial<InsertNonstopTimer>): Promise<NonstopTimer>;
  resetNonstop(): Promise<void>;

  // Authorized Users
  getAuthorizedUsers(): Promise<AuthorizedUser[]>;
  getAuthorizedUserById(id: number): Promise<AuthorizedUser | null>;
  createAuthorizedUser(user: InsertAuthorizedUser): Promise<AuthorizedUser>;
  deleteAuthorizedUser(id: number): Promise<void>;
  isEmailAuthorized(email: string): Promise<boolean>;
  getAuthorizedUserByEmail(email: string): Promise<AuthorizedUser | null>;
  setUserPassword(id: number, hashedPassword: string): Promise<AuthorizedUser>;
}

export class DatabaseStorage implements IStorage {
  async getPlayers(filters?: { level?: string }): Promise<Player[]> {
    if (filters?.level && filters.level !== "all") {
      return await db.select().from(players).where(eq(players.level, filters.level));
    }
    return await db.select().from(players);
  }

  async getPlayersPaginated(filters?: { level?: string; search?: string; page?: number; pageSize?: number }): Promise<PlayersPage> {
    const requestedPage = Number.isFinite(filters?.page) ? Number(filters?.page) : 1;
    const requestedPageSize = Number.isFinite(filters?.pageSize) ? Number(filters?.pageSize) : 25;
    const page = Math.max(1, Math.trunc(requestedPage));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(requestedPageSize)));
    const search = (filters?.search ?? "").trim();

    const conditions: any[] = [];
    if (filters?.level && filters.level !== "all") {
      conditions.push(eq(players.level, filters.level));
    }
    if (search) {
      conditions.push(
        or(
          ilike(players.name, `%${search}%`),
          ilike(players.phone, `%${search}%`),
        )!,
      );
    }

    const whereClause = conditions.length > 1
      ? and(...conditions)
      : conditions[0];

    const countQuery = whereClause
      ? db.select({ total: count() }).from(players).where(whereClause)
      : db.select({ total: count() }).from(players);
    const [{ total }] = await countQuery;

    const dataQuery = whereClause
      ? db
          .select()
          .from(players)
          .where(whereClause)
          .orderBy(desc(players.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
      : db
          .select()
          .from(players)
          .orderBy(desc(players.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
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

  async getTeams(): Promise<Team[]> {
    return await db.select().from(teams);
  }

  async createTeam(insertTeam: InsertTeam): Promise<Team> {
    const [team] = await db.insert(teams).values(insertTeam).returning();
    return team;
  }

  async updateTeam(id: number, update: InsertTeam): Promise<Team> {
    const [team] = await db.update(teams).set(update).where(eq(teams.id, id)).returning();
    return team;
  }

  async deleteTeam(id: number): Promise<void> {
    await db.delete(nonstopResults).where(
      or(
        eq(nonstopResults.teamAId, id),
        eq(nonstopResults.teamBId, id),
      ),
    );
    await db.delete(teams).where(eq(teams.id, id));
  }

  async getResults(): Promise<NonstopResult[]> {
    return await db.select().from(nonstopResults);
  }

  async createOrUpdateResult(insertResult: InsertNonstopResult): Promise<NonstopResult> {
    const round = insertResult.round ?? 1;
    const court = insertResult.court ?? 1;
    
    const [existing] = await db
      .select()
      .from(nonstopResults)
      .where(
        and(
          eq(nonstopResults.round, round),
          eq(nonstopResults.court, court)
        )
      );

    if (existing) {
      const [updated] = await db
        .update(nonstopResults)
        .set({
          teamAId: insertResult.teamAId,
          teamBId: insertResult.teamBId,
          scoreA: insertResult.scoreA,
          scoreB: insertResult.scoreB,
        })
        .where(eq(nonstopResults.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(nonstopResults)
      .values(insertResult)
      .returning();
    return created;
  }

  async clearResults(): Promise<void> {
    await db.delete(nonstopResults);
  }

  async getSettings(): Promise<Settings> {
    const [existing] = await db.select().from(settings);
    if (!existing) {
      const [created] = await db.insert(settings).values({}).returning();
      return created;
    }
    return existing;
  }

  async updateSettings(update: Partial<InsertSettings>): Promise<Settings> {
    const current = await this.getSettings();
    const [updated] = await db
      .update(settings)
      .set(update)
      .where(eq(settings.id, current.id))
      .returning();
    return updated;
  }

  async getNonstopTimer(): Promise<NonstopTimer> {
    const [existing] = await db.select().from(nonstopTimer);
    if (!existing) {
      const [created] = await db.insert(nonstopTimer).values({}).returning();
      return created;
    }
    return existing;
  }

  async updateNonstopTimer(update: Partial<InsertNonstopTimer>): Promise<NonstopTimer> {
    const current = await this.getNonstopTimer();
    const [updated] = await db
      .update(nonstopTimer)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(eq(nonstopTimer.id, current.id))
      .returning();
    return updated;
  }

  async resetNonstop(): Promise<void> {
    await db.delete(nonstopResults);
    await db.delete(teams);
    await db.delete(nonstopTimer);
  }

  // Authorized Users
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
    if (users.length === 0) {
      return true;
    }
    const normalizedEmail = email.toLowerCase();
    return users.some(u => u.email.toLowerCase() === normalizedEmail);
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

export const storage = new DatabaseStorage();
