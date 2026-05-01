import { apiClient } from "../client.js";

export const authService = {
  login(credentials) {
    return apiClient.auth.login(credentials);
  },

  logout() {
    return apiClient.auth.logout();
  },

  getUser() {
    return apiClient.auth.getUser();
  },
};
