import { env } from "../../../config/env.js";

async function request(path, options = {}) {
  const response = await fetch(`${env.backendBaseUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

export const backendUserProvider = {
  getProfile() {
    return request("/users/me");
  },

  updateProfile(payload) {
    return request("/users/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
};
