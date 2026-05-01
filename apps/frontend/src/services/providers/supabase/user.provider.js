import { supabase } from "./supabaseClient.js";

const ok = (data = {}, message = "") => ({ success: true, data, message });
const fail = (message = "Request failed", data = {}) => ({ success: false, data, message });

export const supabaseUserProvider = {
  async getProfile() {
    const { data, error } = await supabase.functions.invoke("admin-ops", {
      body: { action: "dashboard" },
    });
    return error ? fail(error.message) : ok(data, "Profile loaded");
  },

  async updateProfile(payload) {
    const { data, error } = await supabase.functions.invoke("admin-ops", {
      body: { action: "updateProfile", payload },
    });
    return error ? fail(error.message) : ok(data, "Profile updated");
  },
};
