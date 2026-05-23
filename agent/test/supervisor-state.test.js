const assert = require("node:assert/strict");
const test = require("node:test");
const {
  COMMAND_STALE_MS,
  AGENT_HEARTBEAT_STALE_MS,
  AGENT_WATCHDOG_RESTART_COOLDOWN_MS,
  shouldRestartStaleAgent,
  shouldClaimCommand,
} = require("../supervisorState");

test("supervisor claims pending lifecycle commands", () => {
  assert.equal(shouldClaimCommand({ status: "pending" }), true);
});

test("supervisor keeps ownership of commands it already claimed", () => {
  assert.equal(
    shouldClaimCommand({
      status: "running",
      claimed_by: "school-services-supervisor",
      updated_at: new Date().toISOString(),
    }),
    true
  );
});

test("supervisor reclaims stale running commands", () => {
  assert.equal(
    shouldClaimCommand({
      status: "running",
      claimed_by: "agent",
      updated_at: new Date(Date.now() - COMMAND_STALE_MS - 1000).toISOString(),
    }),
    true
  );
});

test("supervisor does not steal fresh commands from another worker", () => {
  assert.equal(
    shouldClaimCommand({
      status: "running",
      claimed_by: "agent",
      updated_at: new Date().toISOString(),
    }),
    false
  );
});

test("supervisor watchdog restarts only stale agent heartbeats outside cooldown", () => {
  const now = Date.now();

  assert.equal(
    shouldRestartStaleAgent(
      { last_seen: new Date(now - AGENT_HEARTBEAT_STALE_MS - 1000).toISOString() },
      {},
      now
    ),
    true
  );
  assert.equal(
    shouldRestartStaleAgent(
      { last_seen: new Date(now - 1000).toISOString() },
      {},
      now
    ),
    false
  );
  assert.equal(
    shouldRestartStaleAgent(
      { last_seen: new Date(now - AGENT_HEARTBEAT_STALE_MS - 1000).toISOString() },
      { lastAgentWatchdogRestartAt: new Date(now - AGENT_WATCHDOG_RESTART_COOLDOWN_MS + 1000).toISOString() },
      now
    ),
    false
  );
});
