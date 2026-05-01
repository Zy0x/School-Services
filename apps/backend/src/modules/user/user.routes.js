import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { userController } from "./user.controller.js";

export const userRoutes = Router();

userRoutes.get("/me", authMiddleware, userController.me);
userRoutes.patch("/me", authMiddleware, userController.updateMe);
