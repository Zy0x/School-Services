import { env } from "../config/env.js";
import { backendAuthProvider } from "./providers/backend/auth.provider.js";
import { backendUserProvider } from "./providers/backend/user.provider.js";
import { supabaseAuthProvider } from "./providers/supabase/auth.provider.js";
import { supabaseUserProvider } from "./providers/supabase/user.provider.js";

export const apiClient = env.useSupabase
  ? {
      auth: supabaseAuthProvider,
      user: supabaseUserProvider,
    }
  : {
      auth: backendAuthProvider,
      user: backendUserProvider,
    };

export const activeProvider = env.useSupabase ? "supabase" : "backend";
