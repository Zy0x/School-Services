import { env } from "../../../config/env.js";

const notReady = (feature) => ({
  data: null,
  error: new Error(`Backend adapter for ${feature} is not implemented yet`),
});

async function request(path, options = {}) {
  const response = await fetch(`${env.backendBaseUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

export const backendLegacyClient = {
  auth: {
    async signInWithPassword(credentials) {
      const response = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      return response.success
        ? { data: response.data, error: null }
        : { data: null, error: new Error(response.message) };
    },

    async signOut() {
      const response = await request("/auth/logout", { method: "POST" });
      return response.success ? { error: null } : { error: new Error(response.message) };
    },

    async getSession() {
      return notReady("auth.getSession");
    },

    async getUser() {
      const response = await request("/auth/me");
      return response.success
        ? { data: { user: response.data }, error: null }
        : { data: { user: null }, error: new Error(response.message) };
    },

    async exchangeCodeForSession() {
      return notReady("auth.exchangeCodeForSession");
    },

    async setSession() {
      return notReady("auth.setSession");
    },

    async updateUser() {
      return notReady("auth.updateUser");
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
  },

  functions: {
    async invoke(name, options = {}) {
      const response = await request(`/legacy/functions/${name}`, {
        method: "POST",
        body: JSON.stringify(options.body || {}),
      });
      return response.success
        ? { data: response.data, error: null }
        : { data: null, error: new Error(response.message) };
    },
  },

  storage: {
    from() {
      return {
        createSignedUrl: () => notReady("storage.createSignedUrl"),
        upload: () => notReady("storage.upload"),
      };
    },
  },

  removeChannel() {},
};
