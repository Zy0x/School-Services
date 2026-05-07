import { corsHeaders, json } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/admin.ts";
import {
  applyLatestReleaseToDevice,
  getLatestGitHubRelease,
  REMOTE_UPDATE_MIN_VERSION,
  supportsRemoteUpdate,
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
      .select(
        "device_id, device_name, status, last_seen, supervisor_last_seen, supervisor_pid, supervisor_desired_agent_state, app_version, release_tag, build_commit, built_at, latest_release_tag, latest_version, update_available, update_status, update_checked_at, update_started_at, update_error, update_asset_name",
      )
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
            supervisorLastSeen: null,
            supervisorPid: null,
            supervisorDesiredAgentState: null,
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
          "device_id, service_name, status, desired_state, public_url, tunnel_provider, tunnel_state, last_public_url, tunnel_last_error, last_error, last_ping, location_status, resolved_path, location_details",
        )
        .eq("device_id", deviceId)
        .eq("service_name", "rapor")
        .maybeSingle();

      if (serviceError) {
        throw serviceError;
      }

      const { data: commandRows, error: commandError } = await service
        .from("commands")
        .select(
          "id, device_id, service_name, action, status, progress_percent, phase, message, error, started_at, updated_at, completed_at, claimed_by, claimed_pid, created_at",
        )
        .eq("device_id", deviceId)
        .or("service_name.eq.rapor,service_name.is.null")
        .order("created_at", { ascending: false })
        .limit(8);

      if (commandError) {
        throw commandError;
      }

      return json({
        ok: true,
        device: {
          deviceId: deviceWithLatest.device_id,
          deviceName: deviceWithLatest.device_name,
          deviceStatus:
            deviceWithLatest.status === "blocked"
              ? "blocked"
              : isFresh(deviceWithLatest.last_seen)
                ? "online"
                : "offline",
          lastSeen: deviceWithLatest.last_seen,
          supervisorLastSeen: deviceWithLatest.supervisor_last_seen || null,
          supervisorPid: deviceWithLatest.supervisor_pid || null,
          supervisorDesiredAgentState:
            deviceWithLatest.supervisor_desired_agent_state || null,
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
        commands: commandRows || [],
      });
    }

    if (action === "cancelCommand") {
      const commandId = Number(body.commandId || body.id);
      if (!Number.isFinite(commandId) || commandId <= 0) {
        return json(
          {
            ok: false,
            error: "commandId wajib diisi untuk membatalkan perintah.",
          },
          { status: 400 },
        );
      }

      const { data: command, error: commandError } = await service
        .from("commands")
        .select("*")
        .eq("id", commandId)
        .eq("device_id", deviceId)
        .maybeSingle();

      if (commandError) {
        throw commandError;
      }
      if (!command) {
        return json(
          { ok: false, error: "Command tidak ditemukan untuk perangkat ini." },
          { status: 404 },
        );
      }
      if (!["pending", "running"].includes(String(command.status || ""))) {
        return json({ ok: true, command, alreadyCompleted: true });
      }

      const message = "Perintah dibatalkan pengguna.";
      const { data: commandRow, error: cancelError } = await service
        .from("commands")
        .update({
          status: "failed",
          progress_percent: 100,
          phase: "cancelled",
          message,
          error: message,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", commandId)
        .eq("device_id", deviceId)
        .in("status", ["pending", "running"])
        .select(
          "id, device_id, service_name, action, status, progress_percent, phase, message, error, started_at, updated_at, completed_at, claimed_by, claimed_pid, created_at",
        )
        .single();

      if (cancelError) {
        throw cancelError;
      }

      return json({ ok: true, command: commandRow, cancelled: true });
    }

    if (action === "start" || action === "stop" || action === "update") {
      if (!device) {
        return json({
          ok: false,
          pendingSetup: true,
          error:
            "Perangkat belum terhubung. Buka aplikasi School Services di komputer ini sampai status perangkat aktif, lalu coba lagi.",
        });
      }

      const latestRelease =
        action === "update" ? await getLatestGitHubRelease(true) : null;
      const deviceWithLatest =
        action === "update"
          ? applyLatestReleaseToDevice(device, latestRelease)
          : device;
      if (action === "update" && !supportsRemoteUpdate(deviceWithLatest)) {
        return json({
          ok: false,
          error: `Agent versi ini belum mendukung update jarak jauh. Jalankan installer School Services v${REMOTE_UPDATE_MIN_VERSION} atau lebih baru langsung di komputer ini.`,
        });
      }
      if (
        action === "update" &&
        deviceWithLatest.update_status === "updating"
      ) {
        return json({
          ok: true,
          queued: true,
          action,
          deviceId,
          serviceName: null,
        });
      }
      if (action === "update" && !deviceWithLatest.update_available) {
        return json({
          ok: false,
          error:
            "Update belum tersedia atau latest GitHub belum memiliki installer yang didukung.",
        });
      }

      const { data: commandRow, error: commandError } = await service
        .from("commands")
        .insert({
          device_id: deviceId,
          service_name: action === "update" ? null : "rapor",
          action,
          status: "pending",
          progress_percent: 0,
          phase: "queued",
          message: "Perintah masuk antrean dan menunggu agent mengambil tugas.",
          error: null,
        })
        .select(
          "id, device_id, service_name, action, status, progress_percent, phase, message, error, started_at, updated_at, completed_at, claimed_by, claimed_pid, created_at",
        )
        .single();

      if (commandError) {
        throw commandError;
      }

      return json({
        ok: true,
        queued: true,
        action,
        deviceId,
        serviceName: action === "update" ? null : "rapor",
        command: commandRow,
      });
    }

    throw new Error(`Unsupported guest action: ${action}`);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
});
