import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { authController } from "./auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/login", authController.login);
authRoutes.post("/logout", authController.logout);
authRoutes.get("/me", authMiddleware, authController.me);
