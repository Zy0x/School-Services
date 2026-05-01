import "dotenv/config";

export const appConfig = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
};
