import { createServer } from "http";
import express from "express";
import { registerRoutes } from "../server/routes";

const app = express();
const httpServer = createServer(app);

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

// Initialize
(async () => {
  try {
    await registerRoutes(httpServer, app);
    app.use((err: any, _req: any, res: any, _next: any) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });
  } catch (error) {
    console.error("[init] Error:", error);
  }
})();

export default function handler(req: any, res: any) {
  app(req, res);
}
