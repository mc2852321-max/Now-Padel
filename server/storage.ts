import { players, teams, nonstopResults, settings, authorizedUsers, type Player, type InsertPlayer, type UpdatePlayerRequest, type Team, type InsertTeam, type NonstopResult, type InsertNonstopResult, type Settings, type InsertSettings, type AuthorizedUser, type InsertAuthorizedUser } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  // Players
  getPlayers(filters?: { level?: string }): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(id: number, player: UpdatePlayerRequest): Promise<Player>;
  deletePlayer(id: number): Promise<void>;

  // Teams
  getTeams(): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;

  // Results
  getResults(): Promise<NonstopResult[]>;
  createOrUpdateResult(result: InsertNonstopResult): Promise<NonstopResult>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;
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

  async resetNonstop(): Promise<void> {
    await db.delete(nonstopResults);
    await db.delete(teams);
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
