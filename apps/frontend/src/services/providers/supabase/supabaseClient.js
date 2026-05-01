import { createClient } from "@supabase/supabase-js";
import { env, assertFrontendEnv } from "../../../config/env.js";

assertFrontendEnv();

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    detectSessionInUrl: false,
  },
});
