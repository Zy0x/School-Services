import { ok } from "../../utils/helpers.js";
import { toPublicUser } from "./user.model.js";
import { userRepository } from "./user.repository.js";

export const userService = {
  async getProfile(user) {
    const profile = await userRepository.findById(user.id);
    return ok(toPublicUser(profile), "Profile loaded");
  },

  async updateProfile(user, payload) {
    const profile = await userRepository.updateById(user.id, payload);
    return ok(toPublicUser(profile), "Profile updated");
  },
};
