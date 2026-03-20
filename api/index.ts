import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "../server/routes";

const app = express();
const httpServer = createServer(app);

let isInitialized = false;
let initPromise: Promise<void> | null = null;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupBaseMiddleware() {
  app.use(
    express.json({
      limit: "100mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ limit: "100mb", extended: false }));
}

async function ensureInitialized() {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      setupBaseMiddleware();
      await registerRoutes(httpServer, app);

      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        res.status(status).json({ message });
      });

      isInitialized = true;
    })();
  }

  await initPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    console.log("[handler] received request:", req.method, req.url);
    await ensureInitialized();
    console.log("[handler] initialized, calling app");
    app(req, res);
    console.log("[handler] request processed");
  } catch (error) {
    console.error("[handler] error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal Server Error", error: String(error) });
    }
  }
}
