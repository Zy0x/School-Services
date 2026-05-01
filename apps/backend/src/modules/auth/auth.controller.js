import { fail } from "../../utils/helpers.js";
import { authService } from "./auth.service.js";
import { loginSchema } from "./auth.validation.js";

export const authController = {
  async login(req, res) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json(fail("Invalid login payload", parsed.error.flatten()));
    }
    const response = await authService.login(parsed.data);
    return res.status(response.success ? 200 : 401).json(response);
  },

  async logout(_req, res) {
    return res.json(await authService.logout());
  },

  async me(req, res) {
    return res.json(await authService.getUser(req.user));
  },
};
