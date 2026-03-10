import express, { type Express, type RequestHandler } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { insertTeamSchema, insertAuthorizedUserSchema, loginSchema, changePasswordSchema } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";

// Session pool for PostgreSQL
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Custom authentication middleware
const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.session && (req.session as any).userId) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Use a very high limit for logo uploads before any other middleware
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Trust proxy for production (Replit uses reverse proxy)
  app.set('trust proxy', 1);

  // Set up session middleware
  const PgSession = connectPgSimple(session);
  app.use(session({
    store: new PgSession({
      pool: pgPool,
      tableName: 'sessions',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'padel-club-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }));

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await storage.getAuthorizedUserByEmail(email);
      
      if (!user) {
        return res.status(401).json({ message: "Email não autorizado" });
      }
      
      if (!user.password) {
        return res.status(401).json({ message: "Password não definida. Contacte o administrador." });
      }
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Password incorreta" });
      }
      
      (req.session as any).userId = user.id;
      (req.session as any).userEmail = user.email;
      (req.session as any).userName = user.name;
      
      res.json({ 
        success: true, 
        user: { id: user.id, email: user.email, name: user.name } 
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Erro ao terminar sessão" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/user", (req, res) => {
    if (req.session && (req.session as any).userId) {
      res.json({
        id: (req.session as any).userId,
        email: (req.session as any).userEmail,
        name: (req.session as any).userName,
      });
    } else {
      res.status(401).json({ message: "Not authenticated" });
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
    const level = req.query.level as string | undefined;
    const players = await storage.getPlayers({ level });
    res.json(players);
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
    const id = Number(req.params.id);
    await storage.deletePlayer(id);
    res.status(204).end();
  });

  app.get("/api/teams", isAuthenticated, async (_req, res) => {
    const teams = await storage.getTeams();
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
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/results", isAuthenticated, async (_req, res) => {
    const results = await storage.getResults();
    res.json(results);
  });

  app.post("/api/results", isAuthenticated, async (req, res) => {
    const { teamAId, teamBId } = req.body;
    if (!Number.isInteger(teamAId) || !Number.isInteger(teamBId) || teamAId < 1 || teamBId < 1) {
      return res.status(400).json({ message: "Valid team IDs are required" });
    }
    const result = await storage.createOrUpdateResult(req.body);
    res.status(201).json(result);
  });

  app.get("/api/settings", isAuthenticated, async (_req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.post("/api/settings", isAuthenticated, async (req, res) => {
    const settings = await storage.updateSettings(req.body);
    res.json(settings);
  });

  app.post("/api/nonstop/reset", isAuthenticated, async (_req, res) => {
    await storage.resetNonstop();
    res.json({ success: true });
  });

  app.get("/api/nonstop/export", isAuthenticated, async (_req, res) => {
    const teams = await storage.getTeams();
    const results = await storage.getResults();
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

    const sortedStandings = Object.values(standings).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      
      const tieBreaker = settings?.tieBreaker || 'direct';
      
      if (tieBreaker === 'direct') {
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
    res.json(users);
  });

  app.post("/api/authorized-users", isAuthenticated, async (req, res) => {
    try {
      const input = insertAuthorizedUserSchema.parse(req.body);
      const user = await storage.createAuthorizedUser(input);
      res.status(201).json(user);
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
  const existing = await storage.getPlayers();
  if (existing.length === 0) {
    await storage.createPlayer({ name: "João Silva", phone: "912345678", level: "M5", notes: "Excelente backhand" });
    await storage.createPlayer({ name: "Maria Santos", phone: "923456789", level: "F3", notes: "Precisa treinar o smash" });
    await storage.createPlayer({ name: "Pedro Costa", phone: "934567890", level: "M4", notes: "Jogador regular" });
    await storage.createPlayer({ name: "Ana Oliveira", phone: "961234567", level: "F6", notes: "Nível de competição" });
  }

  return httpServer;
}
