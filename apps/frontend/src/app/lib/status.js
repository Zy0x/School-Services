import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { HEARTBEAT_STALE_MS, HEARTBEAT_UNSTABLE_MS } from "./constants.js";

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) {
    return "never";
  }

  const deltaMs = new Date(value).getTime() - now;
  if (Number.isNaN(deltaMs)) {
    return "-";
  }

  const absoluteMs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteMs < 60000) {
    return rtf.format(Math.round(deltaMs / 1000), "second");
  }

  if (absoluteMs < 3600000) {
    return rtf.format(Math.round(deltaMs / 60000), "minute");
  }

  if (absoluteMs < 86400000) {
    return rtf.format(Math.round(deltaMs / 3600000), "hour");
  }

  return rtf.format(Math.round(deltaMs / 86400000), "day");
}

export function isFresh(timestamp) {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= HEARTBEAT_STALE_MS;
}

export function deriveDeviceStatus(deviceRecord) {
  if (!deviceRecord) {
    return "offline";
  }
  if (deviceRecord.status === "blocked") {
    return "blocked";
  }
  if (isFresh(deviceRecord.last_seen)) {
    return "online";
  }
  const parsed = new Date(deviceRecord.last_seen).getTime();
  if (Number.isFinite(parsed) && Date.now() - parsed <= HEARTBEAT_UNSTABLE_MS) {
    return "unstable";
  }
  return "offline";
}

export function deriveServiceStatus(row, deviceStatus) {
  if (deviceStatus === "offline") {
    return "offline";
  }
  if (deviceStatus === "blocked") {
    return "blocked";
  }
  return row.status || "unknown";
}

export function statusTone(status) {
  if (status === "pending_setup") {
    return "warn";
  }
  if (
    ["running", "completed", "online", "ready", "super_admin", "approved", "available", "connected"].includes(
      status
    )
  ) {
    return "good";
  }
  if (
    [
      "waiting_retry",
      "starting",
      "partial",
      "pending",
      "running_job",
      "reconnecting",
      "unstable",
      "stopped",
      "idle",
      "degraded",
      "stopping",
      "restarting",
      "updating",
    ].includes(status)
  ) {
    return "warn";
  }
  if (
    [
      "error",
      "failed",
      "blocked",
      "offline",
      "missing",
      "cancelled",
      "expired",
      "disabled",
      "deleted",
      "rejected",
      "unavailable",
    ].includes(status)
  ) {
    return "bad";
  }
  return "neutral";
}

export function getStatusLabel(status) {
  const normalized = String(status || "unknown").trim();
  const labels = {
    unknown: "Belum diketahui",
    online: "Terhubung",
    offline: "Terputus",
    running: "Aktif",
    ready: "Siap",
    completed: "Selesai",
    approved: "Disetujui",
    available: "Tersedia",
    connected: "Terhubung",
    active: "Aktif",
    inactive: "Nonaktif",
    pending_setup: "Disiapkan",
    waiting_retry: "Menunggu",
    starting: "Menyiapkan layanan",
    partial: "Sebagian",
    pending: "Menunggu",
    running_job: "Diproses",
    unstable: "Belum stabil",
    orphaned: "Tanpa job",
    deleted: "Dihapus",
    reconnecting: "Menyambung ulang",
    stopped: "Berhenti",
    stopping: "Menghentikan",
    restarting: "Restart",
    updating: "Update",
    idle: "Siaga",
    degraded: "Belum stabil",
    error: "Gangguan",
    failed: "Gagal",
    blocked: "Dibatasi",
    missing: "Belum lengkap",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
    disabled: "Nonaktif",
    rejected: "Ditolak",
    unavailable: "Tidak tersedia",
    super_admin: "SuperAdmin",
    operator: "Operator",
    user: "User",
  };
  return labels[normalized] || normalized.replace(/_/g, " ");
}

export function getStatusIcon(status) {
  const tone = statusTone(status);
  if (tone === "good") {
    return CheckCircle2;
  }
  if (tone === "bad") {
    return XCircle;
  }
  if (tone === "warn") {
    return AlertTriangle;
  }
  if (tone === "neutral") {
    return Info;
  }
  return Loader2;
}

export function getDeviceStatusBadgeModel(status) {
  const normalized = String(status || "offline").trim();
  const labels = {
    online: "Perangkat terhubung",
    unstable: "Perangkat belum stabil",
    offline: "Perangkat terputus",
    blocked: "Perangkat dibatasi",
    pending_setup: "Perangkat setup awal",
  };
  return {
    status: normalized,
    label: labels[normalized] || `Perangkat ${getStatusLabel(normalized)}`,
  };
}

const AGENT_LIFECYCLE_ACTIONS = new Set([
  "agent_start",
  "agent_stop",
  "agent_restart",
  "update",
]);

function getCommandTimestamp(command) {
  const parsed = new Date(
    command?.completed_at ||
      command?.completedAt ||
      command?.updated_at ||
      command?.updatedAt ||
      command?.started_at ||
      command?.startedAt ||
      command?.created_at ||
      command?.createdAt ||
      0
  ).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getLatestAgentLifecycleCommand(commands = []) {
  return [...commands]
    .filter((command) => AGENT_LIFECYCLE_ACTIONS.has(String(command?.action || "").toLowerCase()))
    .sort((left, right) => getCommandTimestamp(right) - getCommandTimestamp(left))[0] || null;
}

export function deriveAgentStatus(deviceRecord, commands = [], deviceStatus = deriveDeviceStatus(deviceRecord)) {
  if (!deviceRecord) {
    return "pending_setup";
  }
  if (deviceStatus === "blocked") {
    return "blocked";
  }

  const latest = getLatestAgentLifecycleCommand(commands);
  const action = String(latest?.action || "").toLowerCase();
  const status = String(latest?.status || "").toLowerCase();
  if (["pending", "running"].includes(status)) {
    if (action === "agent_stop") {
      return "stopping";
    }
    if (action === "agent_restart") {
      return "restarting";
    }
    if (action === "update") {
      return "updating";
    }
    if (action === "agent_start") {
      return "starting";
    }
  }

  const lastSeenMs = new Date(deviceRecord?.last_seen || deviceRecord?.lastSeen || 0).getTime();
  const latestCommandMs = getCommandTimestamp(latest);
  if (
    action === "agent_stop" &&
    status === "done" &&
    (!Number.isFinite(lastSeenMs) || latestCommandMs >= lastSeenMs)
  ) {
    return "stopped";
  }

  if (deviceStatus === "online") {
    return "running";
  }
  if (deviceStatus === "unstable") {
    return "unstable";
  }
  if (deviceStatus === "offline") {
    return "offline";
  }
  return deviceStatus || "unknown";
}

export function getAgentStatusBadgeModel(status) {
  const normalized = String(status || "unknown").trim();
  const labels = {
    running: "Agent hidup",
    starting: "Agent menyala",
    stopping: "Agent dihentikan",
    restarting: "Agent restart",
    updating: "Agent update",
    stopped: "Agent berhenti",
    unstable: "Agent belum stabil",
    offline: "Agent tidak tersambung",
    blocked: "Agent dibatasi",
    pending_setup: "Agent belum setup",
    unknown: "Agent belum diketahui",
  };
  return {
    status:
      normalized === "running"
        ? "ready"
        : normalized === "stopped"
          ? "stopped"
          : normalized,
    label: labels[normalized] || `Agent ${getStatusLabel(normalized)}`,
  };
}

export function deriveDeviceConnectivityStatus(deviceRecord, deviceStatus = deriveDeviceStatus(deviceRecord)) {
  if (!deviceRecord) {
    return "pending_setup";
  }
  if (deviceStatus === "blocked") {
    return "blocked";
  }

  const supervisorLastSeen = deviceRecord?.supervisor_last_seen || deviceRecord?.supervisorLastSeen || null;
  if (isFresh(supervisorLastSeen)) {
    return "control_ready";
  }

  const parsedSupervisor = new Date(supervisorLastSeen || 0).getTime();
  if (Number.isFinite(parsedSupervisor) && Date.now() - parsedSupervisor <= HEARTBEAT_UNSTABLE_MS) {
    return "control_unstable";
  }

  if (deviceStatus === "online") {
    return supervisorLastSeen ? "device_online" : "device_online_legacy";
  }
  if (deviceStatus === "unstable") {
    return "device_unstable";
  }
  return "offline";
}

export function getDeviceConnectivityBadgeModel(status) {
  const normalized = String(status || "offline").trim();
  const labels = {
    control_ready: "Device online, kontrol agent siap",
    control_unstable: "Kontrol agent belum stabil",
    device_online: "Device online",
    device_online_legacy: "Device online, kontrol agent belum terverifikasi",
    device_unstable: "Device belum stabil",
    offline: "Device offline",
    blocked: "Device dibatasi",
    pending_setup: "Device belum setup",
  };
  const chipStatus = {
    control_ready: "ready",
    control_unstable: "unstable",
    device_online: "ready",
    device_online_legacy: "unstable",
    device_unstable: "unstable",
    offline: "offline",
    blocked: "blocked",
    pending_setup: "pending_setup",
  }[normalized] || normalized;
  return {
    status: chipStatus,
    label: labels[normalized] || `Device ${getStatusLabel(normalized)}`,
  };
}

export function isAgentControlReady(deviceRecord, connectivityStatus = deriveDeviceConnectivityStatus(deviceRecord)) {
  if (connectivityStatus === "control_ready") {
    return true;
  }
  const hasSupervisorField =
    Object.prototype.hasOwnProperty.call(deviceRecord || {}, "supervisor_last_seen") ||
    Object.prototype.hasOwnProperty.call(deviceRecord || {}, "supervisorLastSeen");
  return !hasSupervisorField && connectivityStatus === "device_online_legacy";
}

export function getServiceStatusBadgeModel(status) {
  const normalized = String(status || "unknown").trim();
  const labels = {
    running: "Layanan aktif",
    starting: "Layanan menyiapkan",
    waiting_retry: "Layanan menunggu koneksi",
    reconnecting: "Layanan menyambung ulang",
    stopped: "Layanan berhenti",
    offline: "Layanan terputus",
    blocked: "Layanan dibatasi",
    error: "Layanan terganggu",
    pending_setup: "Layanan menunggu",
    degraded: "Layanan belum stabil",
  };
  return {
    status: normalized,
    label: labels[normalized] || `Layanan ${getStatusLabel(normalized)}`,
  };
}

export function getPublicLinkBadgeModel(service) {
  const serviceStatus = String(service?.serviceStatus || service?.status || "unknown").trim();
  const desiredState = String(service?.desired_state || "").trim();
  const hasPublicUrl = Boolean(service?.public_url);

  if (serviceStatus === "blocked") {
    return { status: "disabled", label: "Tautan dibatasi" };
  }
  if (serviceStatus === "offline") {
    return { status: "disabled", label: "Perangkat offline" };
  }
  if (serviceStatus === "reconnecting") {
    return { status: "reconnecting", label: "Menunggu jaringan stabil" };
  }
  if (serviceStatus === "waiting_retry") {
    return { status: "waiting_retry", label: "Menunggu tunnel baru" };
  }
  if (serviceStatus === "starting") {
    return { status: "starting", label: "Menyiapkan tautan" };
  }
  if (serviceStatus === "error") {
    return {
      status: hasPublicUrl ? "unavailable" : "disabled",
      label: hasPublicUrl ? "Tautan belum stabil" : "Tautan belum tersedia",
    };
  }
  if (serviceStatus === "running" && hasPublicUrl) {
    return { status: "ready", label: "Tautan aktif" };
  }
  if (serviceStatus === "running") {
    return { status: "reconnecting", label: "Menunggu tautan stabil" };
  }
  if (desiredState === "stopped" || serviceStatus === "stopped") {
    return { status: "disabled", label: "Tautan belum aktif" };
  }
  if (hasPublicUrl) {
    return { status: "available", label: "Tautan tersedia" };
  }
  return { status: "disabled", label: "Tautan belum tersedia" };
}

export function getPublicUrlLabel(service) {
  const linkBadge = getPublicLinkBadgeModel(service);
  if (linkBadge.status === "ready") {
    return "Tautan aktif";
  }
  if (linkBadge.status === "available") {
    return "Tautan tersedia";
  }
  if (["starting", "waiting_retry", "reconnecting"].includes(linkBadge.status)) {
    return "Tautan disiapkan";
  }
  return "Tautan akses";
}

export function formatServiceDisplayName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (normalized === "rapor") {
    return "E-Rapor";
  }
  if (normalized === "dapodik") {
    return "Dapodik";
  }
  if (!normalized) {
    return "-";
  }
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}
