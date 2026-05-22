const test = require("node:test");
const assert = require("node:assert/strict");

const { createSupabaseApi } = require("../supabase");

test("Supabase client initializes with a websocket transport under Node 18", () => {
  const api = createSupabaseApi({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
  });

  assert.equal(typeof api.client.channel, "function");
  assert.equal(typeof api.client.realtime.transport, "function");
});
