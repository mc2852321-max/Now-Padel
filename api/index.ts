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
  await ensureInitialized();
  return app(req, res);
}
