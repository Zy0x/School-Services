import jwt from "jsonwebtoken";
import { appConfig } from "../../config/app.js";
import { fail, ok } from "../../utils/helpers.js";
import { authRepository } from "./auth.repository.js";

export const authService = {
  async login({ email, password }) {
    const user = await authRepository.findByEmail(email);
    if (!user || user.password !== password) {
      return fail("Email or password is invalid");
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, appConfig.jwtSecret, {
      expiresIn: "12h",
    });
    return ok({ token, user: { id: user.id, email: user.email, role: user.role } }, "Login success");
  },

  async logout() {
    return ok({}, "Logout success");
  },

  async getUser(user) {
    return ok(user || null, "User loaded");
  },
};
