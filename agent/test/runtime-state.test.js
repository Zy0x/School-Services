const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldRefreshTunnelsAfterReconnect } = require("../runtimeState");

test("short Supabase reconnect gaps preserve current tunnels", () => {
  assert.equal(shouldRefreshTunnelsAfterReconnect(15000, 60000), false);
});

test("long Supabase reconnect gaps force fresh tunnel recovery", () => {
  assert.equal(shouldRefreshTunnelsAfterReconnect(108515009, 60000), true);
});

test("disabled reconnect threshold never forces tunnel refresh", () => {
  assert.equal(shouldRefreshTunnelsAfterReconnect(108515009, 0), false);
});
