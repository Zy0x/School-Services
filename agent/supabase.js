const { createClient } = require("@supabase/supabase-js");

function createSupabaseApi(config) {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let logWriteChain = Promise.resolve();
  let supportsExtendedServiceFields = true;
  let supportsExtendedDeviceFields = true;

  function buildDevicePayload(
    device,
    now = new Date().toISOString(),
    includeExtendedFields = true,
    includeStatus = false
  ) {
    const payload = {
      device_name: device.deviceName,
      last_seen: now,
    };

    if (includeStatus) {
      payload.status = "active";
    }

    if (includeExtendedFields) {
      payload.app_version = device.appVersion || null;
      payload.release_tag = device.releaseTag || null;
      payload.build_commit = device.buildCommit || null;
      payload.built_at = device.builtAt || null;
    }

    return payload;
  }

  function buildServicePayload(service, includeExtendedFields = true) {
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

    if (includeExtendedFields) {
      payload.location_status = service.locationStatus || "unknown";
      payload.resolved_path = service.resolvedPath || null;
      payload.location_details = service.locationDetails || null;
    }

    return payload;
  }

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
      let { error: updateError } = await client
        .from("devices")
        .update(buildDevicePayload(device, now, supportsExtendedDeviceFields, false))
        .eq("device_id", device.deviceId);

      if (
        updateError &&
        supportsExtendedDeviceFields &&
        /column .* does not exist/i.test(updateError.message || "")
      ) {
        supportsExtendedDeviceFields = false;
        ({ error: updateError } = await client
          .from("devices")
          .update(buildDevicePayload(device, now, false, false))
          .eq("device_id", device.deviceId));
      }

      if (updateError) {
        throw updateError;
      }

      return;
    }

    let { error: insertError } = await client.from("devices").insert({
      device_id: device.deviceId,
      ...buildDevicePayload(device, now, supportsExtendedDeviceFields, true),
    });

    if (
      insertError &&
      supportsExtendedDeviceFields &&
      /column .* does not exist/i.test(insertError.message || "")
    ) {
      supportsExtendedDeviceFields = false;
      ({ error: insertError } = await client.from("devices").insert({
        device_id: device.deviceId,
        ...buildDevicePayload(device, now, false, true),
      }));
    }

    if (insertError) {
      throw insertError;
    }
  }

  async function heartbeatDevice(device) {
    const now = new Date().toISOString();
    let { error } = await client
      .from("devices")
      .update(buildDevicePayload(device, now, supportsExtendedDeviceFields, false))
      .eq("device_id", device.deviceId);

    if (
      error &&
      supportsExtendedDeviceFields &&
      /column .* does not exist/i.test(error.message || "")
    ) {
      supportsExtendedDeviceFields = false;
      ({ error } = await client
        .from("devices")
        .update(buildDevicePayload(device, now, false, false))
        .eq("device_id", device.deviceId));
    }

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
    const payload = buildServicePayload(service, supportsExtendedServiceFields);
    let { error } = await client
      .from("services")
      .upsert(payload, { onConflict: "device_id,service_name" });

    if (
      error &&
      supportsExtendedServiceFields &&
      /column .* does not exist/i.test(error.message || "")
    ) {
      supportsExtendedServiceFields = false;
      ({ error } = await client
        .from("services")
        .upsert(buildServicePayload(service, false), {
          onConflict: "device_id,service_name",
        }));
    }

    if (error) {
      throw error;
    }
  }

  async function fetchServiceStates(deviceId) {
    const { data, error } = await client
      .from("services")
      .select("*")
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

  async function fetchNextFileJob(deviceId) {
    const { data, error } = await client
      .from("file_jobs")
      .select("*")
      .eq("device_id", deviceId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  }

  async function claimFileJob(jobId, deviceId) {
    const { data, error } = await client
      .from("file_jobs")
      .update({
        status: "running",
        locked_by_device: deviceId,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function updateFileJob(jobId, patch) {
    const { data, error } = await client
      .from("file_jobs")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function replaceFileRoots(deviceId, roots) {
    if (!Array.isArray(roots) || roots.length === 0) {
      return;
    }

    const { error } = await client.from("file_roots").upsert(
      roots.map((root) => ({
        device_id: deviceId,
        root_key: root.root_key,
        label: root.label,
        path: root.path,
        root_type: root.root_type,
        metadata: root.metadata || {},
        updated_at: new Date().toISOString(),
      })),
      {
        onConflict: "device_id,root_key",
      }
    );

    if (error) {
      throw error;
    }
  }

  async function insertFileAuditLog(entry) {
    const { error } = await client.from("file_audit_logs").insert({
      device_id: entry.deviceId,
      requested_by: entry.requestedBy || null,
      job_id: entry.jobId || null,
      action: entry.action,
      target_path: entry.targetPath || null,
      details: entry.details || {},
    });

    if (error) {
      throw error;
    }
  }

  async function upsertGuestShortcut(entry) {
    const { error } = await client.from("guest_shortcuts").upsert({
      device_id: entry.deviceId,
      guest_path: entry.guestPath,
      guest_url: entry.guestUrl,
      service_name: "rapor",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }
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
    claimFileJob,
    fetchDevice,
    fetchNextFileJob,
    fetchServiceStates,
    fetchPendingCommands,
    heartbeatDevice,
    insertAgentLog,
    insertFileAuditLog,
    markCommandDone,
    replaceFileRoots,
    registerDevice,
    updateFileJob,
    upsertGuestShortcut,
    upsertServiceStatus,
  };
}

module.exports = {
  createSupabaseApi,
};
