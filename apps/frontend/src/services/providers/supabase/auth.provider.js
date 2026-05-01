import { supabase } from "./supabaseClient.js";

const ok = (data = {}, message = "") => ({ success: true, data, message });
const fail = (message = "Request failed", data = {}) => ({ success: false, data, message });

export const supabaseAuthProvider = {
  async login({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? fail(error.message) : ok(data, "Login success");
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    return error ? fail(error.message) : ok({}, "Logout success");
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return error ? fail(error.message) : ok(data.user || null, "User loaded");
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => callback({ event, session }));
  },
};
