const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(
  /\/+$/,
  ""
);
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "");

function getFunctionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

export async function invokeEdgeFunction(name, body, session = null) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
  };

  const response = await fetch(getFunctionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `Edge Function returned HTTP ${response.status}.`
    );
  }

  return payload;
}
