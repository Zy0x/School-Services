import { env } from "../../../config/env.js";

async function request(path, options = {}) {
  const response = await fetch(`${env.backendBaseUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({
    success: false,
    data: {},
    message: "Invalid backend response",
  }));
  return payload;
}

export const backendAuthProvider = {
  login(credentials) {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
  },

  logout() {
    return request("/auth/logout", { method: "POST" });
  },

  getUser() {
    return request("/auth/me");
  },

  onAuthStateChange() {
    return {
      data: {
        subscription: {
          unsubscribe() {},
        },
      },
    };
  },
};
