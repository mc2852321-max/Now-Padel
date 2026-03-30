import { createServer } from "http";
import express from "express";
import { registerRoutes } from "../server/routes.js";

const app = express();
const httpServer = createServer(app);
let initialized = false;
let initError: unknown = null;
let initPromise: Promise<void> | null = null;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// JSON parsing
app.use(express.json({ limit: "100mb", verify: (req: any, _res, buf) => {
  req.rawBody = buf;
}}));
app.use(express.urlencoded({ limit: "100mb", extended: false }));

async function ensureInitialized() {
  if (initialized || initError) {
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await registerRoutes(httpServer, app);
        app.use((err: any, _req: any, res: any, _next: any) => {
          const status = err.status || err.statusCode || 500;
          const message = err.message || "Internal Server Error";
          res.status(status).json({ message });
        });
        initialized = true;
      } catch (error) {
        initError = error;
        console.error("[init] Error:", error);
      }
    })();
  }

  await initPromise;
}

export default async function handler(req: any, res: any) {
  try {
    await ensureInitialized();

    if (initError) {
      return res.status(500).json({
        message: "Server initialization failed",
        detail: initError instanceof Error ? initError.message : "Unknown initialization error",
      });
    }

    app(req, res);
  } catch (error) {
    console.error("[handler] request crash:", error);
    return res.status(500).json({
      message: "Unhandled request error",
      detail: error instanceof Error ? error.message : "Unknown request error",
    });
  }
}
