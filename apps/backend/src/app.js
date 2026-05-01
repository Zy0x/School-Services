import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { API_PREFIX } from "./constants/index.js";
import { appConfig } from "./config/app.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { routes } from "./routes/index.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: appConfig.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(appConfig.env === "production" ? "combined" : "dev"));
  app.use(rateLimiter);
  app.use(API_PREFIX, routes);
  app.use(errorHandler);
  return app;
}
