import { fail } from "../utils/helpers.js";

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  res.status(status).json(fail(error.message || "Internal server error"));
}
