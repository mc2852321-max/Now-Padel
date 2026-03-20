import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "../server/routes";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Setup middleware immediately
app.use(
  express.json({
    limit: "100mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ limit: "100mb", extended: false }));

// Initialize routes synchronously
let initPromise: Promise<void> | null = null;

function getInitPromise() {
  if (!initPromise) {
    initPromise = registerRoutes(httpServer, app).then(() => {
      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        console.error("[error-handler]", status, message);
        res.status(status).json({ message });
      });
    }).catch((err) => {
      console.error("[init] failed:", err);
      throw err;
    });
  }
  return initPromise;
}

// Start initialization immediately
getInitPromise().catch((err) => {
  console.error("[startup] failed to initialize:", err);
});

export default function handler(req: Request, res: Response) {
  console.log("[handler] request:", req.method, req.url);
  try {
    app(req, res);
  } catch (error) {
    console.error("[handler] error:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        message: "Internal Server Error", 
        error: String(error) 
      });
    }
  }
}
