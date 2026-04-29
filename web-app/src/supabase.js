import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const defaultSupabaseUrl = "https://fgimyyicixazygairmsa.supabase.co";
const defaultSupabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnaW15eWljaXhhenlnYWlybXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODg1MjIsImV4cCI6MjA5Mjc2NDUyMn0.uZ0Cm_NxxcSXKaYE21wtob6xtY445S0I0y-v5i10NRo";

if (!(supabaseUrl || defaultSupabaseUrl) || !(supabaseAnonKey || defaultSupabaseAnonKey)) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(
  supabaseUrl || defaultSupabaseUrl,
  supabaseAnonKey || defaultSupabaseAnonKey
);
