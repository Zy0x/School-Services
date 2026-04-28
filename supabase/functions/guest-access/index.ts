import { corsHeaders, json } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/admin.ts";

function isFresh(value: string | null, thresholdMs = 20000) {
  if (!value) {
    return false;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= thresholdMs;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const service = createServiceClient();
    const body = await request.json();
    const action = String(body.action || "status").trim();
    const deviceId = String(body.deviceId || "").trim();

    if (!deviceId) {
      throw new Error("deviceId is required.");
    }

    const { data: device, error: deviceError } = await service
      .from("devices")
      .select("device_id, device_name, status, last_seen")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) {
      throw deviceError;
    }

    if (!device) {
      throw new Error("Guest device not found.");
    }

    if (action === "status") {
      const { data: serviceRow, error: serviceError } = await service
        .from("services")
        .select(
          "device_id, service_name, port, status, desired_state, public_url, last_error, last_ping, location_status, resolved_path, location_details"
        )
        .eq("device_id", deviceId)
        .eq("service_name", "rapor")
        .maybeSingle();

      if (serviceError) {
        throw serviceError;
      }

      return json({
        ok: true,
        device: {
          deviceId: device.device_id,
          deviceName: device.device_name,
          deviceStatus: device.status === "blocked" ? "blocked" : isFresh(device.last_seen) ? "online" : "offline",
          lastSeen: device.last_seen,
        },
        service: serviceRow || null,
      });
    }

    if (action === "start" || action === "stop") {
      const { error: commandError } = await service.from("commands").insert({
        device_id: deviceId,
        service_name: "rapor",
        action,
        status: "pending",
      });

      if (commandError) {
        throw commandError;
      }

      return json({ ok: true, queued: true, action, deviceId, serviceName: "rapor" });
    }

    throw new Error(`Unsupported guest action: ${action}`);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
});
