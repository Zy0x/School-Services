import { corsHeaders, json } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/admin.ts";
import {
  applyLatestReleaseToDevice,
  getLatestGitHubRelease,
} from "../_shared/github-release.ts";

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
      .select("device_id, device_name, status, last_seen, app_version, release_tag, build_commit, built_at, latest_release_tag, latest_version, update_available, update_status, update_checked_at, update_started_at, update_error, update_asset_name")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) {
      throw deviceError;
    }

    if (action === "status") {
      const latestRelease = await getLatestGitHubRelease();
      const deviceWithLatest = device
        ? applyLatestReleaseToDevice(device, latestRelease)
        : null;

      if (!deviceWithLatest) {
        return json({
          ok: true,
          pendingSetup: true,
          device: {
            deviceId,
            deviceName: deviceId,
            deviceStatus: "pending_setup",
            lastSeen: null,
            appVersion: null,
            releaseTag: null,
            buildCommit: null,
            builtAt: null,
            latestReleaseTag: null,
            latestVersion: null,
            updateAvailable: false,
            updateStatus: "unchecked",
            updateCheckedAt: null,
            updateStartedAt: null,
            updateError: null,
            updateAssetName: null,
          },
          service: null,
        });
      }

      const { data: serviceRow, error: serviceError } = await service
        .from("services")
        .select(
          "device_id, service_name, status, desired_state, public_url, last_error, last_ping"
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
          deviceId: deviceWithLatest.device_id,
          deviceName: deviceWithLatest.device_name,
          deviceStatus: deviceWithLatest.status === "blocked" ? "blocked" : isFresh(deviceWithLatest.last_seen) ? "online" : "offline",
          lastSeen: deviceWithLatest.last_seen,
          appVersion: deviceWithLatest.app_version || null,
          releaseTag: deviceWithLatest.release_tag || null,
          buildCommit: deviceWithLatest.build_commit || null,
          builtAt: deviceWithLatest.built_at || null,
          latestReleaseTag: deviceWithLatest.latest_release_tag || null,
          latestVersion: deviceWithLatest.latest_version || null,
          updateAvailable: Boolean(deviceWithLatest.update_available),
          updateStatus: deviceWithLatest.update_status || "unchecked",
          updateCheckedAt: deviceWithLatest.update_checked_at || null,
          updateStartedAt: deviceWithLatest.update_started_at || null,
          updateError: deviceWithLatest.update_error || null,
          updateAssetName: deviceWithLatest.update_asset_name || null,
        },
        service: serviceRow || null,
      });
    }

    if (action === "start" || action === "stop" || action === "update") {
      if (!device) {
        return json({
          ok: false,
          pendingSetup: true,
          error: "Perangkat belum terhubung. Buka aplikasi School Services di komputer ini sampai status perangkat aktif, lalu coba lagi.",
        });
      }

      const latestRelease = action === "update" ? await getLatestGitHubRelease(true) : null;
      const deviceWithLatest = action === "update"
        ? applyLatestReleaseToDevice(device, latestRelease)
        : device;
      if (action === "update" && deviceWithLatest.update_status === "updating") {
        return json({ ok: true, queued: true, action, deviceId, serviceName: null });
      }
      if (action === "update" && !deviceWithLatest.update_available) {
        return json({
          ok: false,
          error: "Update belum tersedia atau latest GitHub belum memiliki installer yang didukung.",
        });
      }

      const { error: commandError } = await service.from("commands").insert({
        device_id: deviceId,
        service_name: action === "update" ? null : "rapor",
        action,
        status: "pending",
      });

      if (commandError) {
        throw commandError;
      }

      return json({ ok: true, queued: true, action, deviceId, serviceName: action === "update" ? null : "rapor" });
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
