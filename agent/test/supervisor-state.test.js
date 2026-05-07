const assert = require("node:assert/strict");
const test = require("node:test");
const {
  COMMAND_STALE_MS,
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
