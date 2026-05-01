import { supabase } from "./providers/supabase/supabaseClient.js";
import { env } from "../config/env.js";
import { backendLegacyClient } from "./providers/backend/legacy.provider.js";

export const legacyDataClient = env.useSupabase ? supabase : backendLegacyClient;
