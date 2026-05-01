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
