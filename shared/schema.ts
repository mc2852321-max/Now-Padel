import { pgTable, text, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  level: text("level").notNull(), // M2, M3, M4, M5, M6, F2, F3, F4, F5, F6
  notes: text("notes"),
  profileTags: text("profile_tags").notNull().default("[]"),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const nonstopResults = pgTable("nonstop_results", {
  id: serial("id").primaryKey(),
  teamAId: integer("team_a_id").notNull(),
  teamBId: integer("team_b_id").notNull(),
  scoreA: integer("score_a").notNull(),
  scoreB: integer("score_b").notNull(),
  round: integer("round").notNull().default(1),
  court: integer("court").notNull().default(1),
  playedAt: timestamp("played_at").defaultNow(),
});

export const nonstopTimer = pgTable("nonstop_timer", {
  id: serial("id").primaryKey(),
  timerState: text("timer_state").notNull().default("idle"),
  isActive: integer("is_active").notNull().default(0),
  round: integer("round").notNull().default(1),
  timeLeft: integer("time_left").notNull().default(0),
  phaseEndsAt: timestamp("phase_ends_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  clubName: text("club_name").notNull().default("Now Padel & Fit"),
  primaryColor: text("primary_color").notNull().default("#f97316"),
  website: text("website").notNull().default("https://nowpadel.pt"),
  whatsappNotifications: integer("whatsapp_notifications").notNull().default(1),
  emailNotifications: integer("email_notifications").notNull().default(0),
  publicRegistration: integer("public_registration").notNull().default(1),
  logo: text("logo"),
  nonstopCourts: integer("nonstop_courts").notNull().default(3),
  nonstopRounds: integer("nonstop_rounds").notNull().default(5),
  gameTime: integer("game_time").notNull().default(20),
  warmupTime: integer("warmup_time").notNull().default(5),
  restTime: integer("rest_time").notNull().default(2),
  startWarmupSound: text("start_warmup_sound").notNull().default("beep-low"),
  startGameSound: text("start_game_sound").notNull().default("beep-high"),
  endGameSound: text("end_game_sound").notNull().default("beep-low"),
  finalSound: text("final_sound").notNull().default("beep-high"),
  airHornDuration: integer("air_horn_duration").notNull().default(5),
  soundDurationTarget: text("sound_duration_target").notNull().default("air-horn"),
  soundDurationSeconds: integer("sound_duration_seconds").notNull().default(5),
  tieBreaker: text("tie_breaker").notNull().default("direct"), // "direct" or "diff"
  playerProfileOptions: text("player_profile_options").notNull().default("[\"Academia\",\"Fecha jogos\",\"Non Stop\"]"),
});

export const insertPlayerSchema = createInsertSchema(players).omit({ id: true }).extend({
  name: z.string().min(1, "O nome é obrigatório"),
  phone: z.string().min(1, "O telemóvel é obrigatório"),
  level: z.string().min(1, "O nível é obrigatório").refine((val) => val !== "placeholder", {
    message: "Por favor, selecione um nível válido",
  }),
});

export const insertTeamSchema = createInsertSchema(teams).omit({ id: true }).extend({
  name: z.string().min(1, "O nome da equipa é obrigatório"),
});
export const insertNonstopResultSchema = createInsertSchema(nonstopResults).omit({ id: true, playedAt: true });

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type NonstopResult = typeof nonstopResults.$inferSelect;
export type InsertNonstopResult = z.infer<typeof insertNonstopResultSchema>;
export type NonstopTimer = typeof nonstopTimer.$inferSelect;
export const insertNonstopTimerSchema = createInsertSchema(nonstopTimer).omit({ id: true, updatedAt: true });
export type InsertNonstopTimer = z.infer<typeof insertNonstopTimerSchema>;

export type Settings = typeof settings.$inferSelect;
export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;

// Explicit API types
export type CreatePlayerRequest = InsertPlayer;
export type UpdatePlayerRequest = Partial<InsertPlayer>;
export type PlayerResponse = Player;
export type PlayersListResponse = {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const messageSchema = z.object({
  playerIds: z.array(z.number()),
  message: z.string(),
});

export type MessageRequest = z.infer<typeof messageSchema>;

// Authorized users for access control
export const authorizedUsers = pgTable("authorized_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password: text("password"), // hashed password
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertAuthorizedUserSchema = createInsertSchema(authorizedUsers).omit({ id: true, addedAt: true, password: true }).extend({
  email: z.string().email("Email inválido").min(1, "O email é obrigatório"),
});
export type AuthorizedUser = typeof authorizedUsers.$inferSelect;
export type InsertAuthorizedUser = z.infer<typeof insertAuthorizedUserSchema>;

// Login schema
export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "A password é obrigatória"),
});
export type LoginRequest = z.infer<typeof loginSchema>;

// Change password schema
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "A password atual é obrigatória"),
  newPassword: z.string().min(4, "A nova password deve ter pelo menos 4 caracteres"),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

// Auth schema exports
export * from "./models/auth.js";
