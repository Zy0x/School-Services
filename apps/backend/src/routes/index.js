import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { userRoutes } from "../modules/user/user.routes.js";
import { ok } from "../utils/helpers.js";

export const routes = Router();

routes.get("/health", (_req, res) => res.json(ok({ status: "ok" }, "Service healthy")));
routes.use("/auth", authRoutes);
routes.use("/users", userRoutes);
