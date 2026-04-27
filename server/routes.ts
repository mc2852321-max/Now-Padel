import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import type { Server } from "http";
import { createLisbonDateTime, getLisbonDateInput, getLisbonTimeInput, storage } from "./storage.js";
import { api } from "../shared/routes.js";
import { insertTeamSchema, insertNonstopResultSchema, createAuthorizedUserRequestSchema, loginSchema, changePasswordSchema, rankingImportSchema } from "../shared/schema.js";
import { z } from "zod";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { db } from "./db.js";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL_NO_SSL;

const shouldUseSsl =
  Boolean(process.env.VERCEL) ||
  Boolean(databaseUrl && /neon\.tech/i.test(databaseUrl)) ||
  Boolean(databaseUrl && /sslmode=require/i.test(databaseUrl));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const loginRateLimitState = new Map<string, { count: number; windowStartedAt: number }>();

// Custom authentication middleware
const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.session && (req.session as any).userId) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

const timerSyncSchema = z.object({
  timerState: z.enum(["idle", "warmup", "game", "rest"]).optional(),
  isActive: z.boolean().optional(),
  round: z.number().int().min(1).optional(),
  timeLeft: z.number().int().min(0).optional(),
  phaseEndsAt: z.string().datetime().nullable().optional(),
});

const finalizeAndStartSchema = z.object({
  label: z.string().max(120).optional(),
});

const nonstopEventMetadataSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, "Data invalida").optional(),
  eventTime: z.string().regex(/^\d{2}:\d{2}$/).refine((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }, "Hora invalida").optional(),
});
const LISBON_TIMEZONE = "Europe/Lisbon";

type BootstrapAuthUser = {
  email: string;
  name: string;
  password: string;
};

function parseEventId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

function parseSeasonYear(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 3000) return undefined;
  return parsed;
}

function getLisbonYear(dateLike?: Date | string | null): number {
  const value = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(value.getTime())) {
    const fallback = Number(new Intl.DateTimeFormat("en-CA", { timeZone: LISBON_TIMEZONE, year: "numeric" }).format(new Date()));
    return Number.isInteger(fallback) ? fallback : new Date().getUTCFullYear();
  }
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: LISBON_TIMEZONE, year: "numeric" }).format(value));
  if (!Number.isInteger(year)) return new Date().getUTCFullYear();
  return year;
}

function toPhaseEndAt(seconds: number): Date {
  return new Date(Date.now() + Math.max(0, seconds) * 1000);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getLoginRateLimitKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const email = normalizeEmail((req.body as { email?: unknown } | undefined)?.email);
  return `${ip}:${email || "-"}`;
}

function pruneLoginRateLimit(now: number): void {
  loginRateLimitState.forEach((state, key) => {
    if (now - state.windowStartedAt >= LOGIN_RATE_LIMIT_WINDOW_MS) {
      loginRateLimitState.delete(key);
    }
  });
}

function enforceLoginRateLimit(req: Request, res: Response): boolean {
  const now = Date.now();
  pruneLoginRateLimit(now);

  const key = getLoginRateLimitKey(req);
  const current = loginRateLimitState.get(key);
  if (!current) return false;

  const elapsed = now - current.windowStartedAt;
  if (elapsed >= LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginRateLimitState.delete(key);
    return false;
  }

  if (current.count < LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }

  const retryAfterSeconds = Math.ceil((LOGIN_RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    message: "Demasiadas tentativas de login. Tenta novamente dentro de alguns minutos.",
  });
  return true;
}

function registerFailedLogin(req: Request): void {
  const now = Date.now();
  const key = getLoginRateLimitKey(req);
  const current = loginRateLimitState.get(key);

  if (!current || now - current.windowStartedAt >= LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginRateLimitState.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  loginRateLimitState.set(key, {
    count: current.count + 1,
    windowStartedAt: current.windowStartedAt,
  });
}

function clearLoginRateLimit(req: Request): void {
  loginRateLimitState.delete(getLoginRateLimitKey(req));
}

function loadBootstrapUsersFromEnv(): BootstrapAuthUser[] {
  const raw = process.env.BOOTSTRAP_AUTH_USERS_JSON?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[startup] BOOTSTRAP_AUTH_USERS_JSON must be a JSON array.");
      return [];
    }

    const uniqueByEmail = new Map<string, BootstrapAuthUser>();
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;

      const email = normalizeEmail((item as { email?: unknown }).email);
      const name = typeof (item as { name?: unknown }).name === "string"
        ? (item as { name?: string }).name!.trim()
        : "";
      const password = typeof (item as { password?: unknown }).password === "string"
        ? (item as { password?: string }).password!
        : "";

      if (!email || !password) continue;

      uniqueByEmail.set(email, {
        email,
        name: name || email,
        password,
      });
    }

    return Array.from(uniqueByEmail.values());
  } catch (error) {
    console.error("[startup] Invalid BOOTSTRAP_AUTH_USERS_JSON:", error);
    return [];
  }
}

async function resolveNonstopTimerState() {
  let timer = await storage.getNonstopTimer();
  const settings = await storage.getSettings();
  const gameSeconds = Math.max(0, Math.floor((settings.gameTime ?? 20) * 60));
  const restSeconds = Math.max(0, Math.floor((settings.restTime ?? 2) * 60));
  const totalRounds = Math.max(1, settings.nonstopRounds ?? 5);
  const maxTransitions = 20;
  let transitions = 0;

  while (
    Boolean(timer.isActive) &&
    timer.phaseEndsAt &&
    new Date(timer.phaseEndsAt).getTime() <= Date.now() &&
    transitions < maxTransitions
  ) {
    transitions += 1;

    if (timer.timerState === "warmup") {
      timer = await storage.updateNonstopTimer({
        timerState: "game",
        isActive: 1,
        round: 1,
        timeLeft: gameSeconds,
        phaseEndsAt: toPhaseEndAt(gameSeconds),
      });
      continue;
    }

    if (timer.timerState === "game") {
      if (timer.round < totalRounds) {
        if (restSeconds > 0) {
          timer = await storage.updateNonstopTimer({
            timerState: "rest",
            isActive: 1,
            round: timer.round,
            timeLeft: restSeconds,
            phaseEndsAt: toPhaseEndAt(restSeconds),
          });
          continue;
        }

        timer = await storage.updateNonstopTimer({
          timerState: "game",
          isActive: 1,
          round: timer.round + 1,
          timeLeft: gameSeconds,
          phaseEndsAt: toPhaseEndAt(gameSeconds),
        });
        continue;
      }

      timer = await storage.updateNonstopTimer({
        timerState: "idle",
        isActive: 0,
        round: timer.round,
        timeLeft: 0,
        phaseEndsAt: null,
      });
      break;
    }

    if (timer.timerState === "rest") {
      timer = await storage.updateNonstopTimer({
        timerState: "game",
        isActive: 1,
        round: timer.round + 1,
        timeLeft: gameSeconds,
        phaseEndsAt: toPhaseEndAt(gameSeconds),
      });
      continue;
    }

    break;
  }

  return timer;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Use a very high limit for logo uploads before any other middleware
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  if (IS_PRODUCTION) {
    // In production we are usually behind a reverse proxy.
    app.set("trust proxy", 1);
  }

  // Set up session middleware
  const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
  if (IS_PRODUCTION && !configuredSessionSecret) {
    throw new Error("SESSION_SECRET is required in production.");
  }
  const sessionConfig: session.SessionOptions = {
    secret: configuredSessionSecret || "dev-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IS_PRODUCTION,
      httpOnly: true,
      sameSite: IS_PRODUCTION ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  };

  if (databaseUrl) {
    try {
      const pgPool = new pg.Pool({
        connectionString: databaseUrl,
        ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
      });
      const PgSession = connectPgSimple(session);
      const sessionStore = new PgSession({
        pool: pgPool,
        tableName: 'sessions',
        createTableIfMissing: true,
      });
      // Prevent unhandled "error" events from crashing the serverless function.
      sessionStore.on("error", (error) => {
        console.error("[session] postgres store error:", error);
      });
      sessionConfig.store = sessionStore;
    } catch (error) {
      console.error("[session] failed to initialize postgres session store:", error);
    }
  }

  const sessionMiddleware = session(sessionConfig);
  app.use((req, res, next) => {
    sessionMiddleware(req, res, (err) => {
      if (err) {
        console.error("[session] middleware error:", err);
        return next();
      }
      next();
    });
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    if (enforceLoginRateLimit(req, res)) {
      return;
    }

    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await storage.getAuthorizedUserByEmail(normalizeEmail(email));
      
      if (!user) {
        registerFailedLogin(req);
        return res.status(401).json({ message: "Email ou palavra-passe incorretos" });
      }
      
      if (!user.password) {
        registerFailedLogin(req);
        return res.status(401).json({ message: "Email ou palavra-passe incorretos" });
      }
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        registerFailedLogin(req);
        return res.status(401).json({ message: "Email ou palavra-passe incorretos" });
      }

      clearLoginRateLimit(req);
      
      (req.session as any).userId = user.id;
      (req.session as any).userEmail = user.email;
      (req.session as any).userName = user.name;
      
      res.json({ 
        success: true, 
        user: { id: user.id, email: user.email, name: user.name } 
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        registerFailedLogin(req);
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    try {
      if (!req.session) {
        return res.status(500).json({ message: "Session não disponível" });
      }
      req.session.destroy((err) => {
        if (err) {
          console.error("[auth/logout] session destroy error:", err);
          return res.status(500).json({ message: "Erro ao terminar sessão" });
        }
        res.json({ success: true });
      });
    } catch (err) {
      console.error("[auth/logout] error:", err);
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.get("/api/auth/user", (req, res) => {
    try {
      if (req.session && (req.session as any).userId) {
        res.json({
          id: (req.session as any).userId,
          email: (req.session as any).userEmail,
          name: (req.session as any).userName,
        });
      } else {
        res.status(401).json({ message: "Not authenticated" });
      }
    } catch (err) {
      console.error("[auth/user] error:", err);
      res.status(500).json({ message: "Erro interno" });
    }
  });

  // Self-service password change (user can only change their own password)
  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      
      const user = await storage.getAuthorizedUserById(userId);
      if (!user || !user.password) {
        return res.status(400).json({ message: "Utilizador não encontrado" });
      }
      
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Password atual incorreta" });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.setUserPassword(userId, hashedPassword);
      
      res.json({ success: true, message: "Password alterada com sucesso" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Erro ao alterar password" });
    }
  });
  
  app.get(api.players.list.path, isAuthenticated, async (req, res) => {
    try {
      const level = req.query.level as string | undefined;
      const search = req.query.search as string | undefined;
      const profileTagQuery = req.query.profileTag;
      const profileTags = Array.isArray(profileTagQuery)
        ? profileTagQuery.map((tag) => String(tag).trim()).filter(Boolean)
        : typeof profileTagQuery === "string"
          ? [profileTagQuery.trim()].filter(Boolean)
          : [];
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 25);
      const players = await storage.getPlayersPaginated({ level, search, profileTags, page, pageSize });
      res.json(players);
    } catch (err) {
      console.error("[players/list] error:", err);
      res.status(500).json({ message: "Erro ao carregar jogadores" });
    }
  });

  app.post(api.players.create.path, isAuthenticated, async (req, res) => {
    try {
      const input = api.players.create.input.parse(req.body);
      const player = await storage.createPlayer(input);
      res.status(201).json(player);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch(api.players.update.path, isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.players.update.input.parse(req.body);
      const player = await storage.updatePlayer(id, input);
      if (!player) return res.status(404).json({ message: "Player not found" });
      res.json(player);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete(api.players.delete.path, isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deletePlayer(id);
      res.status(204).end();
    } catch (err: any) {
      if (err?.code === "23503" || err?.code === "23514") {
        return res.status(400).json({
          message: "Nao e possivel apagar este jogador porque esta associado a dados do Non Stop.",
        });
      }
      console.error("[players/delete] error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/nonstop/current", isAuthenticated, async (_req, res) => {
    const event = await storage.getCurrentNonstopEvent();
    res.json(event);
  });

  app.get("/api/nonstop/events", isAuthenticated, async (req, res) => {
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    const events = await storage.listNonstopEvents({
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    });
    res.json(events);
  });

  app.get("/api/nonstop/events/:id", isAuthenticated, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ message: "Invalid event id" });
    }
    const details = await storage.getNonstopEventDetails(id);
    if (!details) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json(details);
  });

  app.patch("/api/nonstop/events/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ message: "Invalid event id" });
      }

      const input = nonstopEventMetadataSchema.parse(req.body ?? {});
      const current = await storage.getNonstopEventById(id);
      if (!current) {
        return res.status(404).json({ message: "Event not found" });
      }

      let startedAt: Date | undefined;
      if (input.eventDate !== undefined || input.eventTime !== undefined) {
        const currentDate = getLisbonDateInput(current.startedAt ?? current.createdAt);
        const currentTime = getLisbonTimeInput(current.startedAt ?? current.createdAt);
        startedAt = createLisbonDateTime(
          input.eventDate ?? currentDate,
          input.eventTime ?? currentTime,
        );
      }

      const event = await storage.updateNonstopEventMetadata(id, {
        label: input.label,
        startedAt,
      });
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }

      res.json(event);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/nonstop/finalize-and-start", isAuthenticated, async (req, res) => {
    try {
      const input = finalizeAndStartSchema.parse(req.body ?? {});
      const userEmail = (req.session as any)?.userEmail ?? null;
      const result = await storage.finalizeAndStartNonstop({
        label: input.label,
        userEmail,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams", isAuthenticated, async (_req, res) => {
    const eventId = parseEventId(_req.query.eventId);
    const teams = await storage.getTeams(eventId);
    res.json(teams);
  });

  app.post("/api/teams", isAuthenticated, async (req, res) => {
    try {
      const input = insertTeamSchema.parse(req.body);
      const team = await storage.createTeam(input);
      res.status(201).json(team);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (err instanceof Error && err.message === "PLAYER_ALREADY_ASSIGNED") {
        return res.status(400).json({
          message: "Um dos jogadores ja pertence a outra dupla neste evento.",
        });
      }
      if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
        return res.status(400).json({
          message: "Um dos jogadores selecionados nao existe.",
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = insertTeamSchema.parse(req.body);
      const team = await storage.updateTeam(id, input);
      res.json(team);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (err instanceof Error && err.message === "PLAYER_ALREADY_ASSIGNED") {
        return res.status(400).json({
          message: "Um dos jogadores ja pertence a outra dupla neste evento.",
        });
      }
      if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
        return res.status(400).json({
          message: "Um dos jogadores selecionados nao existe.",
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteTeam(id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/results", isAuthenticated, async (_req, res) => {
    const eventId = parseEventId(_req.query.eventId);
    const results = await storage.getResults(eventId);
    res.json(results);
  });

  app.post("/api/results", isAuthenticated, async (req, res) => {
    try {
      const input = insertNonstopResultSchema.parse(req.body);

      if (input.scoreA < 0 || input.scoreB < 0) {
        return res.status(400).json({ message: "Os resultados nao podem ser negativos." });
      }
      if ((input.round ?? 1) < 1 || (input.court ?? 1) < 1) {
        return res.status(400).json({ message: "Ronda e campo devem ser maiores que zero." });
      }

      const result = await storage.createOrUpdateResult(input);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (err instanceof Error && err.message === "RESULT_SAME_TEAM") {
        return res.status(400).json({ message: "As equipas A e B devem ser diferentes." });
      }
      if (err instanceof Error && err.message === "RESULT_TEAM_NOT_IN_EVENT") {
        return res.status(400).json({ message: "Uma das equipas selecionadas nao pertence ao evento atual." });
      }
      console.error("[results/create] error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/results/clear", isAuthenticated, async (_req, res) => {
    await storage.clearResults();
    res.json({ success: true });
  });

  app.get("/api/settings", isAuthenticated, async (_req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.post("/api/settings", isAuthenticated, async (req, res) => {
    const settings = await storage.updateSettings(req.body);
    res.json(settings);
  });

  app.get("/api/ranking", isAuthenticated, async (req, res) => {
    try {
      const onlyWithPoints = String(req.query.onlyWithPoints ?? "1") !== "0";
      const requestedSeason = parseSeasonYear(req.query.season);
      const parsedPage = Number(req.query.page ?? 1);
      const parsedPageSize = Number(req.query.pageSize ?? 25);
      const page = Number.isFinite(parsedPage) ? Math.max(1, Math.trunc(parsedPage)) : 1;
      const pageSize = Number.isFinite(parsedPageSize)
        ? Math.min(100, Math.max(10, Math.trunc(parsedPageSize)))
        : 25;
      const availableSeasons = await storage.getRankingSeasons();
      const currentSeason = getLisbonYear();
      const season = requestedSeason ?? availableSeasons[0] ?? currentSeason;
      const leaderboard = await storage.getRankingLeaderboard(season);
      const filtered = onlyWithPoints
        ? leaderboard.filter((row) => row.totalPoints !== 0 || row.participationCount > 0 || row.roundWins > 0)
        : leaderboard;
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * pageSize;
      const pageItems = filtered.slice(start, start + pageSize);
      const totalPoints = filtered.reduce((sum, row) => sum + row.totalPoints, 0);
      const importedPoints = filtered.reduce((sum, row) => sum + row.importedPoints, 0);

      res.json({
        season,
        availableSeasons,
        page: currentPage,
        pageSize,
        total,
        totalPages,
        summary: {
          totalPoints,
          importedPoints,
        },
        rules: {
          participation: 2,
          loss: 0,
          formats: [
            {
              id: "regra-geral",
              courts: 0,
              rounds: null,
              roundWin: 0,
              description: "Regra geral: pontos por vitória = 15 ÷ número de rondas (se venceres todas as rondas, somas sempre 15 pontos por vitórias).",
            },
            {
              id: "exemplo-3-rondas",
              courts: 2,
              rounds: 3,
              roundWin: 5,
              description: "Exemplo: 3 rondas => +5 pontos por vitória.",
            },
            {
              id: "exemplo-6-rondas",
              courts: 2,
              rounds: 6,
              roundWin: 2.5,
              description: "Exemplo: 6 rondas => +2,5 pontos por vitória.",
            },
            {
              id: "exemplo-15-rondas",
              courts: 2,
              rounds: 15,
              roundWin: 1,
              description: "Exemplo: 15 rondas => +1 ponto por vitória.",
            },
            {
              id: "exemplo-5-rondas",
              courts: 3,
              rounds: 5,
              roundWin: 3,
              description: "Exemplo: 5 rondas => +3 pontos por vitória.",
            },
          ],
        },
        items: pageItems.map((row, index) => ({
          position: start + index + 1,
          ...row,
        })),
      });
    } catch (err) {
      console.error("[ranking/list] error:", err);
      res.status(500).json({ message: "Erro ao carregar ranking" });
    }
  });

  app.get("/api/ranking/entries", isAuthenticated, async (req, res) => {
    try {
      const playerId = parseEventId(req.query.playerId);
      const season = parseSeasonYear(req.query.season);
      const entries = await storage.getRankingEntries(playerId, season);
      res.json(entries);
    } catch (err) {
      console.error("[ranking/entries] error:", err);
      res.status(500).json({ message: "Erro ao carregar historico de pontos" });
    }
  });

  app.post("/api/ranking/import", isAuthenticated, async (req, res) => {
    try {
      const input = rankingImportSchema.parse(req.body);
      const existingPlayers = await storage.getPlayers();
      const existingIds = new Set(existingPlayers.map((player) => player.id));
      const invalidRows = input.rows.filter((row) => !existingIds.has(row.playerId));

      if (invalidRows.length > 0) {
        return res.status(400).json({
          message: "Existem jogadores invalidos na importacao",
          invalidPlayerIds: invalidRows.map((row) => row.playerId),
        });
      }

      const inserted = await storage.importRankingBasePoints(input.rows, {
        batchLabel: input.batchLabel,
        seasonYear: input.seasonYear,
        userEmail: (req.session as any)?.userEmail ?? null,
      });

      res.json({ success: true, inserted });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("[ranking/import] error:", err);
      res.status(500).json({ message: "Erro ao importar pontos iniciais" });
    }
  });

  app.get("/api/nonstop/timer", isAuthenticated, async (_req, res) => {
    const eventId = parseEventId(_req.query.eventId);
    const timer = eventId ? await storage.getNonstopTimer(eventId) : await resolveNonstopTimerState();
    let liveTimeLeft = timer.timeLeft;

    if (!eventId && timer.isActive && timer.phaseEndsAt) {
      liveTimeLeft = Math.max(
        0,
        Math.ceil((new Date(timer.phaseEndsAt).getTime() - Date.now()) / 1000),
      );
    }

    res.json({
      ...timer,
      isActive: Boolean(timer.isActive),
      timeLeft: liveTimeLeft,
    });
  });

  app.post("/api/nonstop/timer", isAuthenticated, async (req, res) => {
    try {
      const input = timerSyncSchema.parse(req.body);
      await storage.updateNonstopTimer({
        timerState: input.timerState,
        isActive: input.isActive === undefined ? undefined : (input.isActive ? 1 : 0),
        round: input.round,
        timeLeft: input.timeLeft,
        phaseEndsAt: input.phaseEndsAt === undefined
          ? undefined
          : input.phaseEndsAt === null
            ? null
            : new Date(input.phaseEndsAt),
      });
      const updated = await resolveNonstopTimerState();

      res.json({
        ...updated,
        isActive: Boolean(updated.isActive),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/nonstop/reset", isAuthenticated, async (req, res) => {
    const userEmail = (req.session as any)?.userEmail ?? null;
    const result = await storage.finalizeAndStartNonstop({ userEmail });
    res.json({ success: true, ...result });
  });

  app.get("/api/nonstop/export", isAuthenticated, async (_req, res) => {
    const eventId = parseEventId(_req.query.eventId);
    const teams = await storage.getTeams(eventId);
    const results = await storage.getResults(eventId);
    const settings = await storage.getSettings();
    
    const numRounds = settings?.nonstopRounds || 5;
    
    const standings: Record<number, { points: number; gamesWon: number; gamesLost: number; teamId: number; name: string; sequence: string[] }> = {};
    
    teams.forEach(team => {
      standings[team.id] = { points: 0, gamesWon: 0, gamesLost: 0, teamId: team.id, name: team.name, sequence: [] };
    });

    results.forEach(result => {
      if (result.scoreA !== null && result.scoreB !== null) {
        const teamA = standings[result.teamAId];
        const teamB = standings[result.teamBId];
        
        if (teamA && teamB) {
          teamA.gamesWon += result.scoreA;
          teamA.gamesLost += result.scoreB;
          teamB.gamesWon += result.scoreB;
          teamB.gamesLost += result.scoreA;

          const hasPlayed = result.scoreA > 0 || result.scoreB > 0;
          if (hasPlayed) {
            if (result.scoreA > result.scoreB) {
              teamA.points += 3;
            } else if (result.scoreB > result.scoreA) {
              teamB.points += 3;
            } else {
              teamA.points += 1;
              teamB.points += 1;
            }
          }
        }
      }
    });

    teams.forEach(team => {
      const teamStandings = standings[team.id];
      for (let r = 1; r <= numRounds; r++) {
        const roundResult = results.find(res => res.round === r && (res.teamAId === team.id || res.teamBId === team.id));
        if (roundResult) {
          const isTeamA = roundResult.teamAId === team.id;
          const score = isTeamA ? roundResult.scoreA : roundResult.scoreB;
          const oppScore = isTeamA ? roundResult.scoreB : roundResult.scoreA;
          const hasPlayed = (score ?? 0) > 0 || (oppScore ?? 0) > 0;
          if (!hasPlayed) teamStandings.sequence.push("-");
          else if ((score ?? 0) > (oppScore ?? 0)) teamStandings.sequence.push("V");
          else if ((score ?? 0) < (oppScore ?? 0)) teamStandings.sequence.push("D");
          else teamStandings.sequence.push("E");
        } else {
          teamStandings.sequence.push("-");
        }
      }
    });

    const tieBreaker = settings?.tieBreaker === "diff" ? "diff" : "direct";
    const sortedStandings = Object.values(standings).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;

      if (tieBreaker === "direct") {
        const directMatch = results.find(r =>
          (r.teamAId === a.teamId && r.teamBId === b.teamId) ||
          (r.teamAId === b.teamId && r.teamBId === a.teamId)
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

    const gamesData = results.map(r => {
      const teamA = teams.find(t => t.id === r.teamAId);
      const teamB = teams.find(t => t.id === r.teamBId);
      return {
        Ronda: r.round,
        Campo: r.court,
        "Equipa A": teamA?.name || "",
        "Resultado A": r.scoreA ?? 0,
        "Equipa B": teamB?.name || "",
        "Resultado B": r.scoreB ?? 0
      };
    }).sort((a, b) => a.Ronda - b.Ronda || a.Campo - b.Campo);

    const standingsData = sortedStandings.map((s, index) => {
      const row: Record<string, any> = {
        "Posição": index + 1,
        "Dupla": s.name,
        "Pontos": s.points,
        "JG": s.gamesWon,
        "JP": s.gamesLost,
        "Dif.": s.gamesWon - s.gamesLost
      };
      s.sequence.forEach((seq, i) => {
        row[`R${i+1}`] = seq;
      });
      return row;
    });

    res.json({ games: gamesData, standings: standingsData });
  });

  // Authorized Users management (protected routes)
  app.get("/api/authorized-users", isAuthenticated, async (_req, res) => {
    const users = await storage.getAuthorizedUsers();
    res.json(users.map(({ password, ...user }) => ({ ...user, password: null })));
  });

  app.post("/api/authorized-users", isAuthenticated, async (req, res) => {
    try {
      const input = createAuthorizedUserRequestSchema.parse(req.body);
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const normalizedEmail = input.email.toLowerCase();
      const user = await storage.createAuthorizedUser({
        email: normalizedEmail,
        name: input.name,
      });
      await storage.setUserPassword(user.id, hashedPassword);
      res.status(201).json({ ...user, password: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if ((err as any)?.code === '23505') {
        return res.status(400).json({ message: "Este email já está na lista" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/authorized-users/:id", isAuthenticated, async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteAuthorizedUser(id);
    res.status(204).end();
  });

  app.post(api.whatsapp.send.path, isAuthenticated, async (req, res) => {
    try {
      const { playerIds, message } = api.whatsapp.send.input.parse(req.body);
      const allPlayers = await storage.getPlayers();
      const selectedPlayers = allPlayers.filter(p => playerIds.includes(p.id));
      
      const phoneNumbers = selectedPlayers.map(p => p.phone).join(',');
      const whatsappUrl = `https://web.whatsapp.com/send?text=${encodeURIComponent(message)}&phone=${phoneNumbers}`;
      
      res.json({ success: true, url: whatsappUrl });
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  // Seed data with new levels
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        level TEXT NOT NULL,
        notes TEXT,
        profile_tags TEXT NOT NULL DEFAULT '[]'
      )
    `);

    await db.execute(sql`
      ALTER TABLE players
      ADD COLUMN IF NOT EXISTS profile_tags TEXT NOT NULL DEFAULT '[]'
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nonstop_events (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        label TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        finalized_by TEXT,
        created_by TEXT,
        snapshot TEXT
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nonstop_events_created_at ON nonstop_events (created_at DESC)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nonstop_results (
        id SERIAL PRIMARY KEY,
        event_id INTEGER,
        team_a_id INTEGER NOT NULL,
        team_b_id INTEGER NOT NULL,
        score_a INTEGER NOT NULL,
        score_b INTEGER NOT NULL,
        round INTEGER NOT NULL DEFAULT 1,
        court INTEGER NOT NULL DEFAULT 1,
        played_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nonstop_timer (
        id SERIAL PRIMARY KEY,
        event_id INTEGER,
        timer_state TEXT NOT NULL DEFAULT 'idle',
        is_active INTEGER NOT NULL DEFAULT 0,
        round INTEGER NOT NULL DEFAULT 1,
        time_left INTEGER NOT NULL DEFAULT 0,
        phase_ends_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS event_id INTEGER
    `);

    await db.execute(sql`
      ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS player_a_id INTEGER
    `);

    await db.execute(sql`
      ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS player_b_id INTEGER
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_results
      ADD COLUMN IF NOT EXISTS event_id INTEGER
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS event_id INTEGER
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS timer_state TEXT NOT NULL DEFAULT 'idle'
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 0
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS time_left INTEGER NOT NULL DEFAULT 0
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS phase_ends_at TIMESTAMP
    `);

    await db.execute(sql`
      ALTER TABLE nonstop_timer
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_teams_event_id ON teams (event_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_results_event_round_court ON nonstop_results (event_id, round, court)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_timer_event_id ON nonstop_timer (event_id)
    `);

    await db.execute(sql`
      DO $$
      DECLARE active_event_id INTEGER;
      BEGIN
        SELECT id INTO active_event_id
        FROM nonstop_events
        WHERE status = 'active'
        ORDER BY id DESC
        LIMIT 1;

        IF active_event_id IS NULL THEN
          INSERT INTO nonstop_events(status) VALUES ('active') RETURNING id INTO active_event_id;
        END IF;

        UPDATE teams SET event_id = active_event_id WHERE event_id IS NULL;
        UPDATE nonstop_results SET event_id = active_event_id WHERE event_id IS NULL;
        UPDATE nonstop_timer SET event_id = active_event_id WHERE event_id IS NULL;

        IF NOT EXISTS (SELECT 1 FROM nonstop_timer WHERE event_id = active_event_id) THEN
          INSERT INTO nonstop_timer(event_id) VALUES (active_event_id);
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY event_id, round, court
            ORDER BY id DESC
          ) AS rn
        FROM nonstop_results
        WHERE event_id IS NOT NULL
      )
      DELETE FROM nonstop_results nr
      USING ranked r
      WHERE nr.id = r.id
        AND r.rn > 1
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_results_event_round_court_unique
      ON nonstop_results (event_id, round, court)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        club_name TEXT NOT NULL DEFAULT 'Now Padel & Fit',
        primary_color TEXT NOT NULL DEFAULT '#f97316',
        website TEXT NOT NULL DEFAULT 'https://nowpadel.pt',
        whatsapp_notifications INTEGER NOT NULL DEFAULT 1,
        email_notifications INTEGER NOT NULL DEFAULT 0,
        public_registration INTEGER NOT NULL DEFAULT 1,
        logo TEXT,
        nonstop_courts INTEGER NOT NULL DEFAULT 3,
        nonstop_rounds INTEGER NOT NULL DEFAULT 5,
        game_time INTEGER NOT NULL DEFAULT 20,
        warmup_time INTEGER NOT NULL DEFAULT 5,
        rest_time INTEGER NOT NULL DEFAULT 2,
        start_warmup_sound TEXT NOT NULL DEFAULT 'beep-low',
        start_game_sound TEXT NOT NULL DEFAULT 'beep-high',
        end_game_sound TEXT NOT NULL DEFAULT 'beep-low',
        final_sound TEXT NOT NULL DEFAULT 'beep-high',
        air_horn_duration INTEGER NOT NULL DEFAULT 5,
        sound_duration_target TEXT NOT NULL DEFAULT 'air-horn',
        sound_duration_seconds INTEGER NOT NULL DEFAULT 5,
        tie_breaker TEXT NOT NULL DEFAULT 'direct',
        player_profile_options TEXT NOT NULL DEFAULT '["Academia","Fecha jogos","Non Stop"]'
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ranking_entries (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        season_year INTEGER NOT NULL,
        event_id INTEGER,
        round INTEGER,
        points DOUBLE PRECISION NOT NULL,
        reason TEXT NOT NULL,
        reason_key TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE ranking_entries
      ALTER COLUMN points TYPE DOUBLE PRECISION
      USING points::DOUBLE PRECISION
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ranking_entries_player_id
      ON ranking_entries (player_id)
    `);

    await db.execute(sql`
      ALTER TABLE ranking_entries
      ADD COLUMN IF NOT EXISTS season_year INTEGER
    `);

    await db.execute(sql`
      UPDATE ranking_entries re
      SET season_year = EXTRACT(YEAR FROM (COALESCE(ne.started_at, ne.created_at) AT TIME ZONE 'Europe/Lisbon'))::INTEGER
      FROM nonstop_events ne
      WHERE re.event_id = ne.id
        AND re.season_year IS NULL
    `);

    await db.execute(sql`
      UPDATE ranking_entries
      SET season_year = EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Europe/Lisbon'))::INTEGER
      WHERE season_year IS NULL
    `);

    await db.execute(sql`
      ALTER TABLE ranking_entries
      ALTER COLUMN season_year SET NOT NULL
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ranking_entries_season_year
      ON ranking_entries (season_year DESC)
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_entries_reason_key
      ON ranking_entries (reason_key)
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_teams_event_id_nonstop_events'
        ) THEN
          ALTER TABLE teams
          ADD CONSTRAINT fk_teams_event_id_nonstop_events
          FOREIGN KEY (event_id)
          REFERENCES nonstop_events(id)
          ON DELETE CASCADE
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      DECLARE existing_definition TEXT;
      BEGIN
        SELECT pg_get_constraintdef(oid)
        INTO existing_definition
        FROM pg_constraint
        WHERE conname = 'fk_teams_player_a_id_players';

        IF existing_definition LIKE '%ON DELETE SET NULL%' THEN
          ALTER TABLE teams
          DROP CONSTRAINT fk_teams_player_a_id_players;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_teams_player_a_id_players'
        ) THEN
          ALTER TABLE teams
          ADD CONSTRAINT fk_teams_player_a_id_players
          FOREIGN KEY (player_a_id)
          REFERENCES players(id)
          ON DELETE RESTRICT
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      DECLARE existing_definition TEXT;
      BEGIN
        SELECT pg_get_constraintdef(oid)
        INTO existing_definition
        FROM pg_constraint
        WHERE conname = 'fk_teams_player_b_id_players';

        IF existing_definition LIKE '%ON DELETE SET NULL%' THEN
          ALTER TABLE teams
          DROP CONSTRAINT fk_teams_player_b_id_players;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_teams_player_b_id_players'
        ) THEN
          ALTER TABLE teams
          ADD CONSTRAINT fk_teams_player_b_id_players
          FOREIGN KEY (player_b_id)
          REFERENCES players(id)
          ON DELETE RESTRICT
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      DECLARE existing_definition TEXT;
      BEGIN
        SELECT pg_get_constraintdef(oid)
        INTO existing_definition
        FROM pg_constraint
        WHERE conname = 'fk_ranking_entries_player_id_players';

        IF existing_definition LIKE '%ON DELETE CASCADE%' THEN
          ALTER TABLE ranking_entries
          DROP CONSTRAINT fk_ranking_entries_player_id_players;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_ranking_entries_player_id_players'
        ) THEN
          ALTER TABLE ranking_entries
          ADD CONSTRAINT fk_ranking_entries_player_id_players
          FOREIGN KEY (player_id)
          REFERENCES players(id)
          ON DELETE RESTRICT
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_ranking_entries_event_id_nonstop_events'
        ) THEN
          ALTER TABLE ranking_entries
          ADD CONSTRAINT fk_ranking_entries_event_id_nonstop_events
          FOREIGN KEY (event_id)
          REFERENCES nonstop_events(id)
          ON DELETE SET NULL
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_nonstop_results_event_id_nonstop_events'
        ) THEN
          ALTER TABLE nonstop_results
          ADD CONSTRAINT fk_nonstop_results_event_id_nonstop_events
          FOREIGN KEY (event_id)
          REFERENCES nonstop_events(id)
          ON DELETE CASCADE
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_nonstop_results_team_a_id_teams'
        ) THEN
          ALTER TABLE nonstop_results
          ADD CONSTRAINT fk_nonstop_results_team_a_id_teams
          FOREIGN KEY (team_a_id)
          REFERENCES teams(id)
          ON DELETE CASCADE
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_nonstop_results_team_b_id_teams'
        ) THEN
          ALTER TABLE nonstop_results
          ADD CONSTRAINT fk_nonstop_results_team_b_id_teams
          FOREIGN KEY (team_b_id)
          REFERENCES teams(id)
          ON DELETE CASCADE
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_teams_players_not_null'
        ) THEN
          ALTER TABLE teams
          ADD CONSTRAINT chk_teams_players_not_null
          CHECK (player_a_id IS NOT NULL AND player_b_id IS NOT NULL)
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_teams_players_different'
        ) THEN
          ALTER TABLE teams
          ADD CONSTRAINT chk_teams_players_different
          CHECK (player_a_id <> player_b_id)
          NOT VALID;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_teams_event_id_nonstop_events') THEN
          BEGIN
            ALTER TABLE teams VALIDATE CONSTRAINT fk_teams_event_id_nonstop_events;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_teams_event_id_nonstop_events: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_teams_player_a_id_players') THEN
          BEGIN
            ALTER TABLE teams VALIDATE CONSTRAINT fk_teams_player_a_id_players;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_teams_player_a_id_players: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_teams_player_b_id_players') THEN
          BEGIN
            ALTER TABLE teams VALIDATE CONSTRAINT fk_teams_player_b_id_players;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_teams_player_b_id_players: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ranking_entries_player_id_players') THEN
          BEGIN
            ALTER TABLE ranking_entries VALIDATE CONSTRAINT fk_ranking_entries_player_id_players;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_ranking_entries_player_id_players: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ranking_entries_event_id_nonstop_events') THEN
          BEGIN
            ALTER TABLE ranking_entries VALIDATE CONSTRAINT fk_ranking_entries_event_id_nonstop_events;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_ranking_entries_event_id_nonstop_events: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nonstop_results_event_id_nonstop_events') THEN
          BEGIN
            ALTER TABLE nonstop_results VALIDATE CONSTRAINT fk_nonstop_results_event_id_nonstop_events;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_nonstop_results_event_id_nonstop_events: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nonstop_results_team_a_id_teams') THEN
          BEGIN
            ALTER TABLE nonstop_results VALIDATE CONSTRAINT fk_nonstop_results_team_a_id_teams;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_nonstop_results_team_a_id_teams: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nonstop_results_team_b_id_teams') THEN
          BEGIN
            ALTER TABLE nonstop_results VALIDATE CONSTRAINT fk_nonstop_results_team_b_id_teams;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate fk_nonstop_results_team_b_id_teams: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_teams_players_not_null') THEN
          BEGIN
            ALTER TABLE teams VALIDATE CONSTRAINT chk_teams_players_not_null;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate chk_teams_players_not_null: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_teams_players_different') THEN
          BEGIN
            ALTER TABLE teams VALIDATE CONSTRAINT chk_teams_players_different;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not validate chk_teams_players_different: %', SQLERRM;
          END;
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS air_horn_duration INTEGER NOT NULL DEFAULT 5
    `);

    await db.execute(sql`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS sound_duration_target TEXT NOT NULL DEFAULT 'air-horn'
    `);

    await db.execute(sql`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS sound_duration_seconds INTEGER NOT NULL DEFAULT 5
    `);

    await db.execute(sql`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS player_profile_options TEXT NOT NULL DEFAULT '["Academia","Fecha jogos","Non Stop"]'
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS authorized_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        password TEXT,
        added_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const bootstrapUsers = loadBootstrapUsersFromEnv();

    for (const bootstrap of bootstrapUsers) {
      let bootstrapUser = await storage.getAuthorizedUserByEmail(bootstrap.email);
      if (!bootstrapUser) {
        bootstrapUser = await storage.createAuthorizedUser({
          email: bootstrap.email,
          name: bootstrap.name,
        });
      }

      if (!bootstrapUser.password) {
        const hashedPassword = await bcrypt.hash(bootstrap.password, 10);
        await storage.setUserPassword(bootstrapUser.id, hashedPassword);
      }
    }

    if (bootstrapUsers.length > 0) {
      console.log(`[startup] processed ${bootstrapUsers.length} bootstrap auth user(s) from BOOTSTRAP_AUTH_USERS_JSON`);
    }

    const authorizedUsers = await storage.getAuthorizedUsers();
    if (authorizedUsers.length === 0) {
      console.warn("[startup] no authorized users found. Define BOOTSTRAP_AUTH_USERS_JSON before first login.");
    }
    const existing = await storage.getPlayers();
    if (existing.length === 0) {
      await storage.createPlayer({ name: "João Silva", phone: "912345678", level: "M5", notes: "Excelente backhand" });
      await storage.createPlayer({ name: "Maria Santos", phone: "923456789", level: "F3", notes: "Precisa treinar o smash" });
      await storage.createPlayer({ name: "Pedro Costa", phone: "934567890", level: "M4", notes: "Jogador regular" });
      await storage.createPlayer({ name: "Ana Oliveira", phone: "961234567", level: "F6", notes: "Nível de competição" });
    }
    await storage.purgeOldNonstopEvents(90);
  } catch (error) {
    console.error("[startup] skipping seed data:", error);
  }

  return httpServer;
}

