import { apiClient } from "../client.js";

export const userService = {
  getProfile() {
    return apiClient.user.getProfile();
  },

  updateProfile(payload) {
    return apiClient.user.updateProfile(payload);
  },
};
