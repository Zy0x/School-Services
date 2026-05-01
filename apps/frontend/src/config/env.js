export const env = {
  useSupabase: String(import.meta.env.VITE_USE_SUPABASE ?? "true") === "true",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  backendBaseUrl: import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:8080/api",
};

export function assertFrontendEnv() {
  if (env.useSupabase && (!env.supabaseUrl || !env.supabaseAnonKey)) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  }
}
