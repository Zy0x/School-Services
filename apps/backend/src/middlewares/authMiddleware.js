import jwt from "jsonwebtoken";
import { appConfig } from "../config/app.js";
import { fail } from "../utils/helpers.js";

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json(fail("Missing authorization token"));
  }

  try {
    req.user = jwt.verify(token, appConfig.jwtSecret);
    return next();
  } catch {
    return res.status(401).json(fail("Invalid authorization token"));
  }
}
