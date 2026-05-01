import rateLimit from "express-rate-limit";
import { fail } from "../utils/helpers.js";

export const rateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json(fail("Too many requests")),
});
