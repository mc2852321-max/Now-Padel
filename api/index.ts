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

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: any = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson: any, ...args: any[]) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      console.log(logLine);
    }
  });

  next();
});

// Track initialization
let initPromise: Promise<void> | null = null;
let isReady = false;

// Initialize routes in parallel as soon as module loads
(() => {
  console.log("[init] starting initialization");
  initPromise = (async () => {
    try {
      console.log("[init] registering routes");
      await registerRoutes(httpServer, app);
      console.log("[init] routes registered successfully");
      
      // Register error handler AFTER routes
      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        console.error("[error-handler]", status, message, err);
        res.status(status).json({ message });
      });
      
      isReady = true;
    } catch (err) {
      console.error("[init] failed to register routes:", err);
      isReady = false;
    }
  })();
})();

// Middleware to wait for initialization if needed
app.use((req, res, next) => {
  if (isReady) {
    next();
  } else if (initPromise) {
    initPromise.then(() => {
      next();
    }).catch((err) => {
      console.error("[middleware] init failed:", err);
      next();
    });
  } else {
    next();
  }
});

export default function handler(req: Request, res: Response) {
  console.log("[handler]", req.method, req.url);
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
    }
  }
}
