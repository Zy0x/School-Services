import { userService } from "./user.service.js";

export const userController = {
  async me(req, res) {
    return res.json(await userService.getProfile(req.user));
  },

  async updateMe(req, res) {
    return res.json(await userService.updateProfile(req.user, req.body));
  },
};
