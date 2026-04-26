const { createClient } = require("@supabase/supabase-js");

function createSupabaseApi(config) {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let logWriteChain = Promise.resolve();

  async function registerDevice(device) {
    const now = new Date().toISOString();
    const { data: existing, error: selectError } = await client
      .from("devices")
      .select("device_id, status")
      .eq("device_id", device.deviceId)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (existing) {
      const { error: updateError } = await client
        .from("devices")
        .update({
          device_name: device.deviceName,
          last_seen: now,
        })
        .eq("device_id", device.deviceId);

      if (updateError) {
        throw updateError;
      }

      return;
    }

    const { error: insertError } = await client.from("devices").insert({
      device_id: device.deviceId,
      device_name: device.deviceName,
      status: "active",
      last_seen: now,
    });

    if (insertError) {
      throw insertError;
    }
  }

  async function heartbeatDevice(device) {
    const { error } = await client
      .from("devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("device_id", device.deviceId);

    if (error) {
      throw error;
    }
  }

  async function fetchDevice(deviceId) {
    const { data, error } = await client
      .from("devices")
      .select("device_id, device_name, status, last_seen")
      .eq("device_id", deviceId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function upsertServiceStatus(service) {
    const payload = {
      device_id: service.deviceId,
      service_name: service.serviceName,
      port: service.port,
      status: service.status,
      desired_state: service.desiredState || null,
      last_error: service.lastError || null,
      public_url: service.publicUrl || null,
      last_ping: new Date().toISOString(),
    };

    const { error } = await client
      .from("services")
      .upsert(payload, { onConflict: "device_id,service_name" });

    if (error) {
      throw error;
    }
  }

  async function fetchServiceStates(deviceId) {
    const { data, error } = await client
      .from("services")
      .select(
        "device_id, service_name, status, desired_state, last_error, public_url, last_ping"
      )
      .eq("device_id", deviceId);

    if (error) {
      throw error;
    }

    return data || [];
  }

  async function fetchPendingCommands(deviceId) {
    const { data, error } = await client
      .from("commands")
      .select("id, device_id, service_name, action, status, created_at")
      .eq("device_id", deviceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return data || [];
  }

  async function markCommandDone(commandId) {
    const { error } = await client
      .from("commands")
      .update({ status: "done" })
      .eq("id", commandId);

    if (error) {
      throw error;
    }
  }

  async function insertAgentLog(entry) {
    logWriteChain = logWriteChain
      .then(async () => {
        const payload = {
          device_id: entry.deviceId,
          service_name: entry.serviceName || null,
          level: entry.level,
          message: entry.message,
          details: entry.details || null,
          created_at: entry.timestamp || new Date().toISOString(),
        };

        const { error } = await client.from("agent_logs").insert(payload);
        if (error) {
          throw error;
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[agent_logs] failed to write log: ${message}`);
      });

    return logWriteChain;
  }

  return {
    client,
    fetchDevice,
    fetchServiceStates,
    fetchPendingCommands,
    heartbeatDevice,
    insertAgentLog,
    markCommandDone,
    registerDevice,
    upsertServiceStatus,
  };
}

module.exports = {
  createSupabaseApi,
};
