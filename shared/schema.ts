import { pgTable, text, serial, varchar, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const nonstopEvents = pgTable("nonstop_events", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("active"),
  label: text("label"),
  category: text("category").notNull().default("Non Stop"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  finalizedBy: text("finalized_by"),
  createdBy: text("created_by"),
  snapshot: text("snapshot"),
});

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
  eventId: integer("event_id"),
  playerAId: integer("player_a_id"),
  playerBId: integer("player_b_id"),
});

export const nonstopResults = pgTable("nonstop_results", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id"),
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
  eventId: integer("event_id"),
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
  nonstopCategories: text("nonstop_categories").notNull().default("[\"Non Stop\"]"),
});

export const rankingEntries = pgTable("ranking_entries", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  seasonYear: integer("season_year").notNull(),
  category: text("category").notNull().default("Non Stop"),
  eventId: integer("event_id"),
  round: integer("round"),
  points: doublePrecision("points").notNull(),
  reason: text("reason").notNull(),
  reasonKey: text("reason_key").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(players).omit({ id: true }).extend({
  name: z.string().min(1, "O nome e obrigatorio"),
  phone: z.string().min(1, "O telemovel e obrigatorio"),
  level: z.string().min(1, "O nivel e obrigatorio").refine((val) => val !== "placeholder", {
    message: "Por favor selecione um nivel valido",
  }),
});

export const insertTeamSchema = createInsertSchema(teams)
  .omit({ id: true, eventId: true })
  .extend({
    name: z.string().min(1, "O nome da equipa e obrigatorio"),
    playerAId: z.number({
      required_error: "Seleciona o jogador A",
      invalid_type_error: "Seleciona o jogador A",
    }).int().positive(),
    playerBId: z.number({
      required_error: "Seleciona o jogador B",
      invalid_type_error: "Seleciona o jogador B",
    }).int().positive(),
  })
  .refine(
    (data) =>
      !(
        typeof data.playerAId === "number" &&
        typeof data.playerBId === "number" &&
        data.playerAId === data.playerBId
      ),
    {
      message: "Os jogadores da dupla devem ser diferentes",
      path: ["playerBId"],
    },
  );

export const insertNonstopResultSchema = createInsertSchema(nonstopResults).omit({ id: true, playedAt: true });
export const insertNonstopEventSchema = createInsertSchema(nonstopEvents).omit({ id: true, createdAt: true });
export const insertRankingEntrySchema = createInsertSchema(rankingEntries).omit({ id: true, createdAt: true });

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type NonstopResult = typeof nonstopResults.$inferSelect;
export type InsertNonstopResult = z.infer<typeof insertNonstopResultSchema>;
export type NonstopEvent = typeof nonstopEvents.$inferSelect;
export type InsertNonstopEvent = z.infer<typeof insertNonstopEventSchema>;
export type RankingEntry = typeof rankingEntries.$inferSelect;
export type InsertRankingEntry = z.infer<typeof insertRankingEntrySchema>;
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

export const messageRecipientSchema = z.object({
  playerId: z.number().int().positive(),
  message: z.string().trim().min(1),
});

export const messageSchema = z.object({
  playerIds: z.array(z.number().int().positive()).optional(),
  message: z.string().trim().min(1).optional(),
  messages: z.array(messageRecipientSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.messages && value.messages.length > 0) return;
  if (value.playerIds && value.playerIds.length > 0 && value.message) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Indica pelo menos um jogador e uma mensagem.",
    path: ["playerIds"],
  });
});

export type MessageRequest = z.infer<typeof messageSchema>;

export const whatsappSendResultSchema = z.object({
  playerId: z.number().int().positive(),
  name: z.string(),
  phone: z.string(),
  number: z.string().nullable(),
  status: z.enum(["mock_sent", "sent", "manual", "failed", "skipped"]),
  fallbackUrl: z.string().optional(),
  providerMessageId: z.string().optional(),
  error: z.string().optional(),
});

export const whatsappSendResponseSchema = z.object({
  success: z.boolean(),
  mode: z.enum(["mock", "evolution", "manual"]),
  total: z.number().int().min(0),
  sent: z.number().int().min(0),
  manual: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  results: z.array(whatsappSendResultSchema),
  fallbackUrl: z.string().optional(),
});

export type WhatsappSendResult = z.infer<typeof whatsappSendResultSchema>;
export type WhatsappSendResponse = z.infer<typeof whatsappSendResponseSchema>;

export const whatsappStatusResponseSchema = z.object({
  mode: z.enum(["mock", "evolution", "manual"]),
  senderNumber: z.string().nullable(),
  evolution: z.object({
    configured: z.boolean(),
    apiUrlConfigured: z.boolean(),
    apiKeyConfigured: z.boolean(),
    instanceConfigured: z.boolean(),
    instance: z.string().nullable(),
    connectionState: z.string().nullable().optional(),
    ownerNumber: z.string().nullable().optional(),
    profileName: z.string().nullable().optional(),
    senderMatchesInstance: z.boolean().optional(),
    error: z.string().optional(),
  }),
});

export type WhatsappStatusResponse = z.infer<typeof whatsappStatusResponseSchema>;

export const rankingImportRowSchema = z.object({
  playerId: z.number().int().positive(),
  points: z.number().finite().refine((value) => Number.isInteger(value * 2), {
    message: "Os pontos devem estar em incrementos de 0,5",
  }),
  note: z.string().optional(),
});

export const rankingImportSchema = z.object({
  batchLabel: z.string().max(120).optional(),
  seasonYear: z.number().int().min(2000).max(3000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  rows: z.array(rankingImportRowSchema).min(1),
});

export type RankingImportRequest = z.infer<typeof rankingImportSchema>;

// Authorized users for access control
export const authorizedUsers = pgTable("authorized_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password: text("password"), // hashed password
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertAuthorizedUserSchema = createInsertSchema(authorizedUsers).omit({ id: true, addedAt: true, password: true }).extend({
  email: z.string().email("Email invalido").min(1, "O email e obrigatorio"),
});
export type AuthorizedUser = typeof authorizedUsers.$inferSelect;
export type InsertAuthorizedUser = z.infer<typeof insertAuthorizedUserSchema>;

export const createAuthorizedUserRequestSchema = insertAuthorizedUserSchema.extend({
  password: z.string().min(4, "A password deve ter pelo menos 4 caracteres"),
});
export type CreateAuthorizedUserRequest = z.infer<typeof createAuthorizedUserRequestSchema>;

// Login schema
export const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(1, "A password e obrigatoria"),
});
export type LoginRequest = z.infer<typeof loginSchema>;

// Change password schema
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "A password atual e obrigatoria"),
  newPassword: z.string().min(4, "A nova password deve ter pelo menos 4 caracteres"),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

// Auth schema exports
export * from "./models/auth.js";
