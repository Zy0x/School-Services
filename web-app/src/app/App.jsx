import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import Avatar3D from "../components/Avatar3D.jsx";
import githubIcon from "../assets/icons/github.png";
import paypalIcon from "../assets/icons/paypal.png";
import trakteerIcon from "../assets/icons/trakteer.png";

const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 90000);
const HEARTBEAT_UNSTABLE_MS = Number(import.meta.env.VITE_HEARTBEAT_UNSTABLE_MS || 180000);
const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
const LOG_LIMIT = 120;
const JOB_LIMIT = 80;
const DEFAULT_SUPABASE_URL = "https://fgimyyicixazygairmsa.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnaW15eWljaXhhenlnYWlybXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODg1MjIsImV4cCI6MjA5Mjc2NDUyMn0.uZ0Cm_NxxcSXKaYE21wtob6xtY445S0I0y-v5i10NRo";
const PUBLIC_DASHBOARD_URL = String(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    "https://school-services.netlify.app"
).replace(/\/+$/, "");
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(
  /\/+$/,
  ""
);
const SUPABASE_ANON_KEY = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
);
const PAYPAL_URL = "https://paypal.me/theamagenta";
const TRAKTEER_URL = "https://trakteer.id/zy0x";
const GITHUB_PROFILE_URL = "https://github.com/Zy0x";
const GUEST_BRAND_ICON = "/icon.png";
const ROOT_PATH = "/";
const AUTH_PATH = "/auth";
const RESET_PASSWORD_PATH = "/auth/reset-password";
const LEGACY_RESET_PASSWORD_PATH = "/reset-password";
const DASHBOARD_SECTIONS = new Set(["overview", "devices", "files", "activity", "accounts", "profile"]);

function normalizePathname(pathname = "") {
  const normalized = `/${String(pathname || "/").trim()}`.replace(/\/+/g, "/");
  return normalized.replace(/\/+$/, "") || "/";
}

function buildPath(pathname = "/", params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value || "").trim();
    if (normalized) {
      search.set(key, normalized);
    }
  }
  const suffix = search.toString();
  return `${pathname}${suffix ? `?${suffix}` : ""}`;
}

function buildPublicUrl(pathname = "/", params = {}) {
  return `${PUBLIC_DASHBOARD_URL}${buildPath(pathname, params)}`;
}

function parseAppRoute(pathname = "") {
  const path = normalizePathname(pathname) || "/dashboard";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "dashboard") {
    return { section: "overview", deviceId: "" };
  }

  const section = DASHBOARD_SECTIONS.has(parts[1]) ? parts[1] : "overview";
  return {
    section,
    deviceId: section === "devices" ? decodeURIComponent(parts[2] || "") : "",
  };
}

function buildRoutePath(section = "overview", params = {}) {
  const safeSection = DASHBOARD_SECTIONS.has(section) ? section : "overview";
  if (safeSection === "devices" && params.deviceId) {
    return `/dashboard/devices/${encodeURIComponent(params.deviceId)}`;
  }
  return `/dashboard/${safeSection}`;
}

function getAllowedDashboardSections(role) {
  const sections = new Set(["overview", "devices", "activity", "profile"]);
  if (role === "super_admin") {
    sections.add("files");
    sections.add("accounts");
  }
  if (role === "operator") {
    sections.add("accounts");
  }
  return sections;
}

function getRouteCopy(section, role) {
  const fallback = {
    title: "Ringkasan",
    subtitle: "Lihat kondisi perangkat dan layanan yang tersedia.",
    kicker: "School Services",
  };
  const copies = {
    overview: {
      title: "Ringkasan",
      subtitle:
        role === "super_admin"
          ? "Lihat kondisi perangkat, akun, dan layanan sekolah dari satu tempat."
          : role === "operator"
            ? "Kelola perangkat dan akun pengguna di lingkungan Anda."
            : "Lihat status perangkat dan layanan yang dapat Anda akses.",
      kicker: role === "super_admin" ? "SuperAdmin" : role === "operator" ? "Operator" : "User",
    },
    devices: {
      title: "Perangkat",
      subtitle: "Kelola nama tampilan dan layanan pada perangkat yang tersedia untuk akun Anda.",
      kicker: "Layanan",
    },
    files: {
      title: "Berkas",
      subtitle: "Lihat dan kelola berkas pada perangkat yang dipilih.",
      kicker: "SuperAdmin",
    },
    activity: {
      title: "Aktivitas",
      subtitle: "Lihat riwayat tindakan dan perubahan terbaru.",
      kicker: "Riwayat",
    },
    accounts: {
      title: role === "operator" ? "Akun Lingkungan" : "Akun & Lingkungan",
      subtitle:
        role === "operator"
          ? "Kelola akun pengguna dan kode akses lingkungan Anda."
          : "Kelola akun, lingkungan, dan akses perangkat.",
      kicker: "Akses",
    },
    profile: {
      title: "Profil",
      subtitle: "Kelola informasi akun dan password Anda.",
      kicker: "Akun",
    },
  };
  return copies[section] || fallback;
}

function buildGuestPath(deviceId) {
  return `/guest/${encodeURIComponent(String(deviceId || "").trim())}`;
}

function buildGuestUrl(deviceId) {
  return buildPublicUrl(buildGuestPath(deviceId));
}

function buildAuthPath(params = {}) {
  return buildPath(AUTH_PATH, params);
}

function buildAuthUrl(params = {}) {
  return buildPublicUrl(AUTH_PATH, params);
}

function buildResetPasswordUrl() {
  return buildPublicUrl(RESET_PASSWORD_PATH);
}

function getFunctionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

function isInvalidSessionError(error) {
  const message = String(error?.message || error || "");
  return /invalid admin session|missing authorization header|jwt|unauthorized/i.test(message);
}

function isSamePasswordError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || error || "").trim().toLowerCase();
  return (
    code === "same_password" ||
    /same password|different password|password.*same|different from the one currently used/i.test(message)
  );
}

function formatEdgeFunctionError(error) {
  const message = String(error?.message || error || "Unknown error");
  if (/email rate limit exceeded/i.test(message)) {
    return "Terlalu banyak permintaan reset password. Coba lagi beberapa menit lagi.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "Email atau password belum sesuai. Periksa kembali lalu coba masuk lagi.";
  }
  if (isInvalidSessionError(message)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  if (/missing authorization header/i.test(message)) {
    return "Sesi Anda tidak lagi valid. Silakan masuk kembali.";
  }
  if (/failed to fetch|networkerror/i.test(message)) {
    return "Koneksi ke layanan sedang bermasalah. Periksa internet Anda lalu coba lagi.";
  }
  return message || "Permintaan belum berhasil diproses. Silakan coba lagi.";
}

function formatSignInError(error) {
  const message = String(error?.message || error || "");
  if (/invalid login credentials/i.test(message)) {
    return "Email atau password belum sesuai. Coba lagi atau gunakan fitur lupa password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Email akun belum terverifikasi. Periksa inbox Anda lalu coba masuk kembali.";
  }
  if (/too many requests|rate limit/i.test(message)) {
    return "Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba kembali.";
  }
  return formatEdgeFunctionError(message);
}

function formatPasswordUpdateError(error) {
  if (isInvalidSessionError(error)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  if (isSamePasswordError(error)) {
    return "Password baru tidak boleh sama dengan password yang lama.";
  }
  return String(error?.message || error || "Gagal memperbarui password.");
}

function clearStoredAuthArtifacts() {
  if (typeof window === "undefined") {
    return;
  }

  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    if (!storage) {
      continue;
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      if (/^sb-.*(auth-token|code-verifier)/i.test(key)) {
        storage.removeItem(key);
      }
    }
  }
}

async function invokeEdgeFunction(name, body, session = null) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
  };

  const response = await fetch(getFunctionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `Edge Function returned HTTP ${response.status}.`
    );
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function safeFileNameFromKey(objectKey) {
  return String(objectKey || "").split("/").filter(Boolean).pop() || "berkas";
}

function getJobStatusDetail(job) {
  if (job?.status === "running" && job?.result?.pendingUpload) {
    return "Berkas sudah siap. Menunggu koneksi internet untuk dikirim.";
  }

  if (job?.status === "completed" && Array.isArray(job?.result?.parts) && job.result.parts.length > 1) {
    return `Berkas tersedia dalam ${job.result.parts.length} bagian. Unduh semua bagian untuk menyusunnya kembali.`;
  }

  if (job?.status === "completed" && job?.artifact_bucket && job?.artifact_object_key) {
    return "Berkas siap diunduh.";
  }

  return "";
}

function formatRelativeTime(value, now = Date.now()) {
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

function getFileKindLabel(item) {
  if (!item) {
    return "-";
  }
  if (item.type === "directory") {
    return "Folder";
  }
  const extension = String(item.name || "").split(".").pop();
  if (!extension || extension === item.name) {
    return "File";
  }
  return `${extension.toUpperCase()} file`;
}

function getItemGlyph(item) {
  if (!item) {
    return "ITEM";
  }
  if (item.type === "directory") {
    return "DIR";
  }
  const extension = String(item.name || "").toLowerCase().split(".").pop();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "IMG";
  }
  if (["zip", "rar", "7z"].includes(extension)) {
    return "ZIP";
  }
  if (["pdf"].includes(extension)) {
    return "PDF";
  }
  if (["txt", "md", "log", "json", "env", "ini", "sql"].includes(extension)) {
    return "TXT";
  }
  return "FILE";
}

function buildBreadcrumbs(targetPath) {
  const value = String(targetPath || "").trim();
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\//g, "\\");
  const match = normalized.match(/^([A-Za-z]:\\)(.*)$/);
  if (!match) {
    return [{ label: normalized, path: normalized }];
  }

  const root = match[1];
  const rest = match[2];
  const parts = rest.split("\\").filter(Boolean);
  const crumbs = [{ label: root.replace(/\\$/, ""), path: root }];
  let cursor = root;

  for (const part of parts) {
    cursor = cursor.endsWith("\\") ? `${cursor}${part}` : `${cursor}\\${part}`;
    crumbs.push({ label: part, path: cursor });
  }

  return crumbs;
}

function isFresh(timestamp) {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= HEARTBEAT_STALE_MS;
}

function deriveDeviceStatus(deviceRecord) {
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

function deriveServiceStatus(row, deviceStatus) {
  if (deviceStatus === "offline") {
    return "offline";
  }
  if (deviceStatus === "blocked") {
    return "blocked";
  }
  return row.status || "unknown";
}

function getDeviceStatusBadgeModel(status) {
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

function getServiceStatusBadgeModel(status) {
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

function getPublicLinkBadgeModel(service) {
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

function getPublicUrlLabel(service) {
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

function formatVersionLabel(version, releaseTag) {
  const normalizedReleaseTag = String(releaseTag || "").trim();
  if (normalizedReleaseTag) {
    return normalizedReleaseTag;
  }

  const normalizedVersion = String(version || "").trim();
  if (!normalizedVersion) {
    return "belum dilaporkan";
  }

  return normalizedVersion.startsWith("v") ? normalizedVersion : `v${normalizedVersion}`;
}

const REMOTE_UPDATE_MIN_VERSION = "2.0.3";

function normalizeVersionToken(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function parseVersionParts(value) {
  const match = normalizeVersionToken(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function getDeviceVersionToken(deviceRecord) {
  return (
    normalizeVersionToken(deviceRecord?.app_version || deviceRecord?.appVersion) ||
    normalizeVersionToken(deviceRecord?.release_tag || deviceRecord?.releaseTag)
  );
}

function supportsRemoteUpdate(deviceRecord) {
  const localParts = parseVersionParts(getDeviceVersionToken(deviceRecord));
  const minParts = parseVersionParts(REMOTE_UPDATE_MIN_VERSION);
  return Boolean(localParts && minParts && compareVersionParts(localParts, minParts) >= 0);
}

function getDeviceVersionLabel(deviceRecord) {
  return formatVersionLabel(
    deviceRecord?.app_version || deviceRecord?.appVersion,
    deviceRecord?.release_tag || deviceRecord?.releaseTag
  );
}

function getDeviceLatestVersionLabel(deviceRecord) {
  return formatVersionLabel(
    deviceRecord?.latest_version || deviceRecord?.latestVersion,
    deviceRecord?.latest_release_tag || deviceRecord?.latestReleaseTag
  );
}

function getDeviceUpdateModel(deviceRecord) {
  const status = String(
    deviceRecord?.update_status || deviceRecord?.updateStatus || "unchecked"
  ).trim();
  const updateAvailable = Boolean(
    deviceRecord?.update_available ?? deviceRecord?.updateAvailable
  );
  const checkedAt = deviceRecord?.update_checked_at || deviceRecord?.updateCheckedAt || null;
  const startedAt = deviceRecord?.update_started_at || deviceRecord?.updateStartedAt || null;
  const error = deviceRecord?.update_error || deviceRecord?.updateError || "";
  const localVersion = getDeviceVersionLabel(deviceRecord);
  const latestVersion = getDeviceLatestVersionLabel(deviceRecord);
  const normalizedStatus =
    status === "updating"
      ? "updating"
      : status === "failed"
        ? "failed"
        : updateAvailable
          ? "available"
          : status === "current"
            ? "current"
            : "unchecked";
  const labels = {
    available: "Update tersedia",
    current: "Sudah terbaru",
    updating: "Sedang update",
    failed: "Gagal update",
    unchecked: "Belum dicek",
  };

  return {
    status: normalizedStatus,
    label: labels[normalizedStatus] || labels.unchecked,
    toneStatus:
      normalizedStatus === "current"
        ? "ready"
        : normalizedStatus === "available" || normalizedStatus === "updating"
          ? "reconnecting"
          : normalizedStatus === "failed"
            ? "failed"
            : "unknown",
    localVersion,
    latestVersion,
    checkedAt,
    startedAt,
    error,
    updateAvailable,
  };
}

function normalizeLoginEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLoginPassword(value) {
  return String(value || "");
}

function statusTone(status) {
  if (status === "pending_setup") {
    return "warn";
  }
  if (
    [
      "running",
      "completed",
      "online",
      "ready",
      "super_admin",
      "approved",
      "available",
      "connected",
    ].includes(status)
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

function getStatusLabel(status) {
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

function getActivityLabel(value) {
  const normalized = String(value || "").trim();
  const labels = {
    list_directory: "Buka folder",
    discover_roots: "Muat lokasi",
    preview_file: "Lihat file",
    download_file: "Unduh file",
    archive_paths: "Siapkan arsip",
    upload_place: "Unggah file",
    transfer: "Aktivitas berkas",
    activity: "Aktivitas",
    complete_preview_file: "Pratinjau selesai",
    complete_download_file: "Unduhan selesai",
    complete_archive_paths: "Arsip selesai",
    complete_upload_place: "Unggahan selesai",
  };
  return labels[normalized] || normalized.replace(/_/g, " ");
}

function StatusChip({ status, label }) {
  return (
    <span className={`status-chip tone-${statusTone(status)}`}>
      {label || getStatusLabel(status)}
    </span>
  );
}

function InfoHint({ text }) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text}>
      i
      <span className="info-hint-bubble">{text}</span>
    </span>
  );
}

function ActionButton({
  children,
  busy = false,
  className = "secondary-button",
  disabled = false,
  ...props
}) {
  return (
    <button type="button" className={`${className} action-button`} disabled={disabled || busy} {...props}>
      {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function NavIcon({ section }) {
  const paths = {
    overview: "M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-5H4v5Zm10 0h6v-8h-6v8Z",
    devices: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v8A2.5 2.5 0 0 1 16.5 17H14v2h2.5a1 1 0 1 1 0 2h-9a1 1 0 1 1 0-2H10v-2H7.5A2.5 2.5 0 0 1 5 14.5v-8Zm2.5-.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-9Z",
    files: "M4 6.5A2.5 2.5 0 0 1 6.5 4h4.2l2 2H17.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-9Z",
    activity: "M5 12h3l2-6 4 12 2-6h3a1 1 0 1 0 0-2h-4.4l-.6 1.8L10 0 6.6 10H5a1 1 0 1 0 0 2Z",
    accounts: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 18.5C3 15.5 5.5 13 8.5 13s5.5 2.5 5.5 5.5V20H3v-1.5Zm12.5.2c0-1.7-.6-3.3-1.7-4.5.5-.1 1.1-.2 1.7-.2A4.5 4.5 0 0 1 20 18.5V20h-4.5v-1.3Z",
    profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z",
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[section] || paths.overview} />
    </svg>
  );
}

function getDashboardNavItems({ isSuperAdmin, isOperator, deviceCount, pendingAccounts, runningJobs }) {
  return [
    { id: "overview", label: "Ringkasan", helper: "Kondisi utama", badge: deviceCount },
    { id: "devices", label: "Perangkat", helper: "Nama dan layanan", badge: deviceCount },
    ...(isSuperAdmin ? [{ id: "files", label: "Berkas", helper: "Kelola berkas", badge: runningJobs }] : []),
    { id: "activity", label: "Aktivitas", helper: "Riwayat terbaru", badge: runningJobs },
    ...((isSuperAdmin || isOperator)
      ? [{ id: "accounts", label: "Akun", helper: "Pengguna dan akses", badge: pendingAccounts }]
      : []),
    { id: "profile", label: "Profil", helper: "Data akun" },
  ];
}

function SidebarNav({ profile, activeSection, items, onNavigate, onTransferHistory }) {
  return (
    <aside className="app-sidebar" aria-label="Navigasi dashboard">
      <div className="app-sidebar-brand">
        <img src={GUEST_BRAND_ICON} alt="" aria-hidden="true" />
        <div>
          <strong>School Services</strong>
          <span>{getStatusLabel(profile.role)}</span>
        </div>
      </div>
      <nav className="app-nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app-nav-item ${activeSection === item.id ? "app-nav-item-active" : ""}`}
            aria-current={activeSection === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon section={item.id} />
            <span className="app-nav-copy">
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </span>
            {Number(item.badge || 0) > 0 ? <span className="app-nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      {profile.role === "super_admin" ? (
        <button type="button" className="app-sidebar-cta" onClick={onTransferHistory}>
          <span>Riwayat Berkas</span>
          <small>Lihat aktivitas berkas terbaru</small>
        </button>
      ) : null}
    </aside>
  );
}

function MobileNav({ activeSection, items, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Navigasi mobile">
      {items.slice(0, 5).map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-nav-item ${activeSection === item.id ? "mobile-nav-item-active" : ""}`}
          aria-current={activeSection === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <NavIcon section={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function RouteHeader({ route, profile, channelState, loading, authBusy, onRefresh, onSignOut }) {
  const copy = getRouteCopy(route.section, profile.role);
  return (
    <header className="app-route-header">
      <div>
        <div className="route-kicker">{copy.kicker}</div>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <StatusChip status={channelState || "connecting"} label={channelState || "connecting"} />
        <ActionButton className="secondary-button" busy={loading} onClick={onRefresh}>
          Refresh
        </ActionButton>
        <ActionButton className="secondary-button" busy={authBusy} onClick={onSignOut}>
          Log Out
        </ActionButton>
      </div>
    </header>
  );
}

function DashboardStats({ devices, fileJobs, accounts, now }) {
  const onlineDevices = devices.filter((device) => device.deviceStatus !== "offline").length;
  const runningServices = devices.reduce((total, device) => total + device.runningCount, 0);
  const issueCount = devices.reduce((total, device) => total + device.issueCount, 0);
  const runningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;

  return (
    <section className="dashboard-stats-grid" aria-label="Ringkasan dashboard">
      {[
        ["Perangkat aktif", `${onlineDevices}/${devices.length}`, "Perangkat yang tersambung saat ini."],
        ["Layanan aktif", runningServices, "Layanan yang siap digunakan."],
        ["Perlu perhatian", issueCount, "Perangkat atau layanan yang perlu dicek."],
        ["Proses berkas", runningJobs, "Aktivitas berkas yang sedang berlangsung."],
        ["Akun menunggu", pendingAccounts, "Akun yang menunggu persetujuan."],
      ].map(([label, value, helper]) => (
        <article key={label} className="dashboard-stat-card">
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{helper}</small>
        </article>
      ))}
      <article className="dashboard-stat-card">
        <span>Update data</span>
        <strong>{formatRelativeTime(new Date(now).toISOString(), now)}</strong>
        <small>Data diperbarui otomatis tanpa memuat ulang halaman.</small>
      </article>
    </section>
  );
}

function DeviceGrid({ devices, selectedDeviceId, onOpen, now }) {
  return (
    <section className="device-grid" aria-label="Daftar perangkat">
      {devices.map((device) => (
        <button
          key={device.deviceId}
          type="button"
          className={`device-grid-card ${selectedDeviceId === device.deviceId ? "device-grid-card-active" : ""}`}
          onClick={() => onOpen(device.deviceId)}
        >
          <span className="device-grid-top">
            <strong>{device.deviceName}</strong>
            <StatusChip status={device.deviceStatus} />
          </span>
          <span className="mono">{device.deviceId}</span>
          <span className="device-grid-meta">
            {device.runningCount} layanan aktif | {device.issueCount} perlu perhatian |{" "}
            {formatRelativeTime(device.deviceRecord?.last_seen, now)}
          </span>
        </button>
      ))}
    </section>
  );
}

function SupportIcon({ kind }) {
  const icons = {
    github: githubIcon,
    paypal: paypalIcon,
    trakteer: trakteerIcon,
  };
  return <img src={icons[kind] || trakteerIcon} alt="" aria-hidden="true" />;
}

async function copyTextToClipboard(text) {
  if (!text) {
    throw new Error("Tidak ada tautan yang bisa disalin.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "readonly");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function buildWhatsAppShareUrl(url, label = "Tautan akses") {
  const text = `${label}\n${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function getGuestStatusModel(device, service) {
  const deviceStatus = device?.deviceStatus || "offline";
  const serviceStatus =
    deviceStatus === "blocked"
      ? "blocked"
      : deviceStatus === "pending_setup"
        ? "pending_setup"
      : deviceStatus === "offline"
        ? "offline"
        : service?.status || "unknown";
  const desiredState = service?.desired_state || "unknown";
  const hasPublicUrl = Boolean(service?.public_url);
  const ready =
    deviceStatus === "online" &&
    serviceStatus === "running" &&
    desiredState !== "stopped" &&
    hasPublicUrl;

  if (deviceStatus === "blocked") {
    return {
      overallStatus: "blocked",
      headline: "Akses perangkat dibatasi",
      description:
        "Perangkat tersedia, tetapi aksesnya sedang dibatasi. Hubungi pengelola untuk mengaktifkannya kembali.",
      publicStatus: "disabled",
      publicLabel: "Tautan dibatasi",
      runtimeLabel: "Perangkat diblokir",
      runtimeChipLabel: "dibatasi",
      ready,
    };
  }

  if (deviceStatus === "pending_setup") {
    return {
      overallStatus: "pending_setup",
      headline: "Perangkat sedang disiapkan",
      description:
        "Perangkat sedang disiapkan. Tunggu beberapa saat, lalu segarkan halaman ini.",
      publicStatus: "disabled",
      publicLabel: "Tautan belum tersedia",
      runtimeLabel: "Menunggu perangkat",
      runtimeChipLabel: "setup awal",
      ready: false,
    };
  }

  if (deviceStatus === "offline") {
    return {
      overallStatus: "offline",
      headline: "Perangkat belum terhubung",
      description:
        "Pastikan aplikasi School Services sedang berjalan dan perangkat memiliki koneksi internet.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "Tautan terakhir tersedia" : "Tautan belum tersedia",
      runtimeLabel: "Belum tersambung",
      runtimeChipLabel: "offline",
      ready,
    };
  }

  if (ready) {
    return {
      overallStatus: "ready",
      headline: "E-Rapor siap digunakan",
      description:
        "Perangkat tersambung dan layanan E-Rapor siap dibuka.",
      publicStatus: "ready",
      publicLabel: "Tautan aktif",
      runtimeLabel: "Layanan aktif",
      runtimeChipLabel: "aktif",
      ready,
    };
  }

  if (serviceStatus === "reconnecting") {
    return {
      overallStatus: "reconnecting",
      headline: "Jaringan sedang berpindah",
      description:
        "Koneksi perangkat atau tunnel Cloudflare sedang disegarkan. Tunggu sampai tautan baru benar-benar siap dibuka.",
      publicStatus: "reconnecting",
      publicLabel: "Menunggu jaringan stabil",
      runtimeLabel: "Layanan menyambung ulang",
      runtimeChipLabel: "menyambung ulang",
      ready,
    };
  }

  if (serviceStatus === "starting") {
    return {
      overallStatus: "starting",
      headline: "E-Rapor sedang disiapkan",
      description:
        "Permintaan diterima. Layanan sedang dinyalakan dan koneksi publik sedang disiapkan.",
      publicStatus: "starting",
      publicLabel: "Menyiapkan tautan",
      runtimeLabel: "Sedang memulai layanan",
      runtimeChipLabel: "menyiapkan",
      ready,
    };
  }

  if (serviceStatus === "waiting_retry") {
    return {
      overallStatus: "reconnecting",
      headline: "Koneksi publik sedang dipulihkan",
      description:
        "Jaringan atau tunnel Cloudflare sedang beralih. Status akan aktif setelah tautan baru berhasil dihubungkan.",
      publicStatus: "waiting_retry",
      publicLabel: "Menunggu tunnel baru",
      runtimeLabel: "Layanan menunggu koneksi",
      runtimeChipLabel: "menunggu koneksi",
      ready,
    };
  }

  if (serviceStatus === "running" && !hasPublicUrl) {
    return {
      overallStatus: "degraded",
      headline: "Layanan aktif, koneksi publik belum stabil",
      description:
        "E-Rapor sudah berjalan, tetapi tautan publik masih menunggu verifikasi koneksi sebelum dinyatakan siap.",
      publicStatus: "reconnecting",
      publicLabel: "Menunggu tautan stabil",
      runtimeLabel: "Layanan aktif",
      runtimeChipLabel: "aktif",
      ready,
    };
  }

  if (serviceStatus === "error") {
    return {
      overallStatus: "error",
      headline: "Layanan memerlukan perhatian",
      description:
        "Layanan belum dapat dibuka. Periksa informasi di bawah atau hubungi pengelola.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "Tautan belum stabil" : "Tautan belum tersedia",
      runtimeLabel: "Perlu dicek",
      runtimeChipLabel: "perlu dicek",
      ready,
    };
  }

  if (desiredState === "stopped" || serviceStatus === "stopped") {
    return {
      overallStatus: "stopped",
      headline: "Layanan belum dijalankan",
      description:
        "Perangkat tersambung. Tekan Mulai untuk menyalakan E-Rapor.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "Tautan terakhir tersedia" : "Tautan belum tersedia",
      runtimeLabel: "Layanan berhenti",
      runtimeChipLabel: "berhenti",
      ready,
    };
  }

  return {
    overallStatus: serviceStatus,
    headline: "Status layanan sedang diperiksa",
    description:
      "Status layanan sedang diperbarui. Tunggu beberapa saat lalu segarkan halaman.",
    publicStatus: hasPublicUrl ? "available" : "disabled",
    publicLabel: hasPublicUrl ? "Tautan tersedia" : "Tautan belum tersedia",
    runtimeLabel: "Menunggu pembaruan status",
    runtimeChipLabel: serviceStatus,
    ready,
  };
}

function PublicLinkActions({
  url,
  label = "Tautan akses",
  compact = false,
  onActionComplete = null,
}) {
  const [feedback, setFeedback] = useState("");
  const disabled = !url;

  async function handleCopy() {
    if (!url) {
      return;
    }

    try {
      await copyTextToClipboard(url);
      setFeedback("Tautan berhasil disalin.");
      if (typeof onActionComplete === "function") {
        onActionComplete("");
      }
    } catch (error) {
      const message = error?.message || "Gagal menyalin tautan.";
      setFeedback("");
      if (typeof onActionComplete === "function") {
        onActionComplete(message);
      }
    }
  }

  function handleWhatsAppShare() {
    if (!url) {
      return;
    }

    window.open(buildWhatsAppShareUrl(url, label), "_blank", "noopener,noreferrer");
    setFeedback("Tautan siap dibagikan lewat WhatsApp.");
    if (typeof onActionComplete === "function") {
      onActionComplete("");
    }
  }

  return (
    <div className={`link-action-stack ${compact ? "link-action-stack-compact" : ""}`}>
      <div className="panel-actions public-link-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={handleCopy}
        >
          Salin tautan
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={handleWhatsAppShare}
        >
          Bagikan WhatsApp
        </button>
      </div>
      {feedback ? <div className="micro-feedback">{feedback}</div> : null}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-copy">
        <strong>School Services v2.0.4</strong>
        <p>
          Akses layanan sekolah dan pantau status E-Rapor dengan tampilan yang ringkas.
        </p>
      </div>
      <div className="support-cluster">
        <div className="support-cluster-copy">
          <span className="section-eyebrow">Buy Me a Coffee</span>
          <strong>Dukung School Services</strong>
        </div>
        <div className="site-footer-actions">
        <a
          className="secondary-button footer-link-button support-link-button"
          href={GITHUB_PROFILE_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="github" />
          Support GitHub
        </a>
        <a
          className="secondary-button footer-link-button support-link-button"
          href={PAYPAL_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="paypal" />
          PayPal
        </a>
        <a
          className="secondary-button footer-link-button support-link-button"
          href={TRAKTEER_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="trakteer" />
          Trakteer
        </a>
        </div>
      </div>
    </footer>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled = false,
  visible = null,
  onToggleVisibility = null,
}) {
  const [localVisible, setLocalVisible] = useState(false);
  const controlled = typeof visible === "boolean";
  const isVisible = controlled ? visible : localVisible;

  function toggleVisibility() {
    if (typeof onToggleVisibility === "function") {
      onToggleVisibility();
      return;
    }
    setLocalVisible((current) => !current);
  }

  return (
    <label className="password-field">
      {label ? <span>{label}</span> : null}
      <div className="password-input-shell">
        <input
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={isVisible ? "Sembunyikan password" : "Lihat password"}
          aria-pressed={isVisible}
          onClick={toggleVisibility}
          disabled={disabled}
        >
          {isVisible ? "Sembunyikan" : "Lihat"}
        </button>
      </div>
    </label>
  );
}

function LoginScreen({
  mode,
  email,
  password,
  displayName,
  role,
  registrationMode,
  referralCode,
  setEmail,
  setPassword,
  setDisplayName,
  setRole,
  setRegistrationMode,
  setReferralCode,
  setMode,
  onSubmit,
  onForgotPassword,
  error,
  info,
  loading,
}) {
  return (
    <main className="login-shell">
      <div className="login-card">
        <section className="auth-visual-panel">
          <div>
            <Avatar3D />
            <div className="login-eyebrow">School Services</div>
            <h2>Akses E-Rapor lebih mudah</h2>
            <p>
              Buka layanan sekolah dan lihat status perangkat melalui halaman yang ringkas.
            </p>
          </div>
          <div className="auth-visual-list" aria-label="Fitur akses">
            <span>Akses mengikuti jenis akun Anda.</span>
            <span>Status layanan ditampilkan dengan jelas.</span>
          </div>
        </section>
        <section className="auth-form-panel">
        <div className="login-eyebrow">{mode === "register" ? "Daftar Akun" : "Selamat Datang"}</div>
        <h1>{mode === "register" ? "Ajukan akun" : "Masuk"}</h1>
        <p>
          Gunakan akun yang telah terdaftar untuk melanjutkan.
        </p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nama@email.com"
              autoComplete="username"
              disabled={loading}
            />
          </label>
          {mode === "register" ? (
            <>
              <label>
                <span>Nama</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Nama lengkap"
                  disabled={loading}
                />
              </label>
              <label>
                <span>Jenis akun</span>
                <select value={role} onChange={(event) => setRole(event.target.value)} disabled={loading}>
                  <option value="operator">Operator</option>
                  <option value="user">User</option>
                </select>
              </label>
              {role === "user" ? (
                <>
                  <label>
                    <span>Jalur pendaftaran</span>
                    <select
                      value={registrationMode}
                      onChange={(event) => setRegistrationMode(event.target.value)}
                      disabled={loading}
                    >
                      <option value="referral_code">Gunakan kode lingkungan</option>
                      <option value="direct_superadmin">Ajukan langsung</option>
                    </select>
                  </label>
                  {registrationMode === "referral_code" ? (
                    <label>
                      <span>Kode lingkungan</span>
                      <input
                        type="text"
                        value={referralCode}
                        onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                        placeholder="Contoh: ABCD123456"
                        disabled={loading}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? "Buat password" : "Masukkan password"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            disabled={loading}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="explorer-warning">{info}</div> : null}
          <button className="primary-button login-button" disabled={loading} type="submit">
            {loading
              ? mode === "register"
                ? "Mengirim..."
                : "Masuk..."
              : mode === "register"
                ? "Ajukan akun"
                : "Masuk"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Kembali ke masuk" : "Ajukan akun"}
          </button>
          {mode === "login" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onForgotPassword}
              disabled={loading || !email}
            >
              Lupa password
            </button>
          ) : null}
        </form>
        </section>
      </div>
    </main>
  );
}

function AccountStatusScreen({ profile, onSignOut }) {
  const label =
    !profile
      ? "Profil akun belum ditemukan. Silakan masuk ulang atau hubungi pengelola sistem."
      : profile?.status === "pending"
      ? "Akses akun Anda masih diproses. Silakan pantau kembali halaman ini setelah jadwal persetujuan berjalan."
      : profile?.status === "rejected"
        ? "Permintaan akun Anda belum dapat disetujui. Hubungi pengelola lingkungan atau SuperAdmin untuk tindak lanjut."
        : "Akun Anda sedang dinonaktifkan. Hubungi pengelola sistem bila perlu aktivasi ulang.";

  return (
    <main className="login-shell">
      <div className="login-card auth-simple-card">
        <div className="login-eyebrow">Status Akun</div>
        <h1>{profile?.display_name || profile?.email || "Akun"}</h1>
        <p>{label}</p>
        {profile?.approval_due_at ? (
          <div className="explorer-warning">
            Estimasi persetujuan otomatis: {formatRelativeTime(profile.approval_due_at)}
          </div>
        ) : null}
        <div className="panel-actions" style={{ marginTop: 16 }}>
          <StatusChip status={profile?.status || "unknown"} />
          {profile?.role ? <StatusChip status={profile.role} /> : null}
        </div>
        <div className="panel-actions" style={{ marginTop: 20 }}>
          <ActionButton className="secondary-button" onClick={onSignOut}>
            Log Out
          </ActionButton>
        </div>
      </div>
    </main>
  );
}

function ProfilePanel({ profile, session, onSignOut }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNextPasswords, setShowNextPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submitPasswordChange() {
    const currentPasswordValue = String(currentPassword || "");
    const nextPasswordValue = String(nextPassword || "");
    const confirmPasswordValue = String(confirmPassword || "");

    if (!currentPasswordValue) {
      setError("Password saat ini wajib diisi.");
      setInfo("");
      return;
    }

    if (nextPasswordValue.length < 8) {
      setError("Password baru minimal 8 karakter.");
      setInfo("");
      return;
    }

    if (currentPasswordValue === nextPasswordValue) {
      setError("Password baru tidak boleh sama dengan password saat ini.");
      setInfo("");
      return;
    }

    if (nextPasswordValue !== confirmPasswordValue) {
      setError("Konfirmasi password tidak cocok.");
      setInfo("");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");
      await invokeEdgeFunction("account-access", {
        action: "changeOwnPassword",
        currentPassword: currentPasswordValue,
        nextPassword: nextPasswordValue,
      }, session);
      await supabase.auth.signOut({ scope: "global" }).catch(() =>
        supabase.auth.signOut({ scope: "local" }).catch(() => {})
      );
      clearStoredAuthArtifacts();
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setInfo("Password berhasil diperbarui. Silakan login ulang.");
      window.setTimeout(() => {
        onSignOut();
      }, 700);
    } catch (updateError) {
      if (isInvalidSessionError(updateError)) {
        setError("Sesi login telah berakhir. Silakan masuk lagi.");
        onSignOut();
        return;
      }
      setError(formatPasswordUpdateError(updateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-stack">
      <article className="service-panel">
        <div className="panel-heading-row">
          <h3>Profil</h3>
          <div className="service-status-group">
            <StatusChip status={profile?.status || "unknown"} />
            {profile?.role ? <StatusChip status={profile.role} /> : null}
          </div>
        </div>
        <div className="service-detail-grid">
          <div>
            <span>Nama</span>
            <strong>{profile?.display_name || "-"}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{profile?.email || session?.user?.email || "-"}</strong>
          </div>
          <div>
            <span>ID akun</span>
            <strong className="mono">{session?.user?.id || "-"}</strong>
          </div>
        </div>
      </article>

      <article className="service-panel">
        <div className="panel-heading-row">
          <h3>Ganti Password</h3>
        </div>
        <div className="service-detail-grid">
          <PasswordField
            label="Password saat ini"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Masukkan password saat ini"
            autoComplete="current-password"
            disabled={busy}
          />
          <PasswordField
            label="Password baru"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <div>
            <span>Aksi akun</span>
            <div className="panel-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || !currentPassword || !nextPassword || !confirmPassword}
                onClick={submitPasswordChange}
              >
                {busy ? "Menyimpan..." : "Simpan password"}
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={onSignOut}>
                Log Out
              </button>
            </div>
          </div>
        </div>
        {error ? <div className="job-error">{error}</div> : null}
        {info ? <div className="service-note">{info}</div> : null}
      </article>
    </section>
  );
}

function GuestConsole({ deviceId }) {
  const [state, setState] = useState({ device: null, service: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [commandModal, setCommandModal] = useState({
    open: false,
    action: "",
    title: "",
    message: "",
  });

  async function loadGuest(options = {}) {
    const silent = Boolean(options.silent);
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const { data, error: invokeError } = await supabase.functions.invoke("guest-access", {
        body: { action: "status", deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Status perangkat belum dapat dimuat.");
      }
      setState({ device: data.device, service: data.service });
      setError("");
    } catch (nextError) {
      setError(formatEdgeFunctionError(nextError));
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadGuest();
    const refreshId = window.setInterval(() => loadGuest({ silent: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshId);
  }, [deviceId]);

  useEffect(() => {
    const channel = supabase
      .channel(`guest-console:${deviceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `device_id=eq.${deviceId}` },
        () => loadGuest({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services", filter: `device_id=eq.${deviceId}` },
        () => loadGuest({ silent: true })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId]);

  async function sendCommand(action) {
    try {
      setBusy(true);
      const isUpdateAction = action === "update";
      setCommandModal({
        open: true,
        action,
        title:
          action === "start"
            ? "Menyalakan E-Rapor"
            : isUpdateAction
              ? "Mengupdate Agent & Service"
              : "Menghentikan E-Rapor",
        message:
          action === "start"
            ? "Permintaan sedang diproses. Status halaman akan diperbarui otomatis."
            : isUpdateAction
              ? "Permintaan update sedang dikirim. Installer silent akan berjalan setelah agent menerima command."
              : "Permintaan sedang diproses. Tunggu beberapa saat sampai status berubah.",
      });
      const { data, error: invokeError } = await supabase.functions.invoke("guest-access", {
        body: { action, deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Permintaan belum dapat diproses.");
      }
      await loadGuest({ silent: true });
      setCommandModal((current) => ({
        ...current,
        message:
          action === "start"
            ? "E-Rapor sedang dinyalakan. Status akan berubah setelah layanan siap."
            : isUpdateAction
              ? "Update diminta. Agent akan menghentikan layanan, memasang versi baru, lalu aktif kembali otomatis."
              : "E-Rapor sedang dihentikan. Status akan diperbarui setelah selesai.",
      }));
      if (!isUpdateAction) {
        window.setTimeout(() => {
          setCommandModal((current) => ({ ...current, open: false }));
        }, 1200);
      }
    } catch (nextError) {
      setError(formatEdgeFunctionError(nextError));
      setCommandModal((current) => ({
        ...current,
        open: true,
        message: formatEdgeFunctionError(nextError),
      }));
    } finally {
      setBusy(false);
    }
  }

  const service = state.service;
  const guestStatus = getGuestStatusModel(state.device, service);
  const deviceBadge = getDeviceStatusBadgeModel(state.device?.deviceStatus || "offline");
  const guestRuntimeStatus =
    guestStatus.overallStatus === "ready" || guestStatus.overallStatus === "degraded"
      ? "running"
      : guestStatus.overallStatus;
  const guestRuntimeBadge = getServiceStatusBadgeModel(guestRuntimeStatus);
  const guestUpdate = getDeviceUpdateModel(state.device);
  const canOpenService = guestStatus.ready;
  const isRunning = service?.status === "running" && service?.desired_state !== "stopped";
  const loginUrl = buildAuthUrl({
    mode: "login",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });
  const registerUrl = buildAuthUrl({
    mode: "register",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });

  useEffect(() => {
    if (guestUpdate.status === "updating") {
      setCommandModal({
        open: true,
        action: "update",
        title: "Mengupdate Agent & Service",
        message: "Pembaruan otomatis sedang berjalan. Agent akan hidup kembali setelah installer selesai.",
      });
    }
  }, [guestUpdate.status]);

  return (
    <main className="console-shell guest-console-shell">
      <header className="guest-nav">
        <div className="guest-brand">
          <Avatar3D size="sm" />
          <div>
            <div className="section-eyebrow">School Services</div>
            <strong>Akses Perangkat</strong>
          </div>
        </div>
        <div className="guest-nav-actions">
          <a className="secondary-button footer-link-button" href={loginUrl}>
            Masuk
          </a>
          <a className="primary-button footer-link-button" href={registerUrl}>
            Daftar
          </a>
        </div>
      </header>

      <section className="guest-hero">
        <div className="guest-hero-copy">
          <div className="section-eyebrow">Status Layanan</div>
          <h1>{state.device?.deviceName || deviceId}</h1>
          <p>{guestStatus.description}</p>
          <div className="guest-hero-badges">
            <StatusChip
              status={deviceBadge.status}
              label={deviceBadge.label}
            />
            <StatusChip
              status={guestRuntimeBadge.status}
              label={guestRuntimeBadge.label}
            />
            <StatusChip
              status={guestStatus.publicStatus}
              label={guestStatus.publicLabel}
            />
          </div>
        </div>
        <div className="guest-hero-actions">
          <StatusChip status={guestStatus.overallStatus} label={guestStatus.headline} />
          <button
            type="button"
            className={`secondary-button ${refreshing ? "button-busy" : ""}`}
            onClick={() => loadGuest({ silent: true })}
            disabled={refreshing}
          >
            {refreshing ? "Menyegarkan..." : "Segarkan"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace guest-workspace" style={{ marginTop: 18 }}>
        {loading ? (
          <div className="empty-state">Memuat status perangkat...</div>
        ) : (
          <>
            <section className="guest-status-grid">
              <article className="metric-card guest-status-card">
                <span>Koneksi perangkat</span>
                <strong>
                  {state.device?.deviceStatus === "online"
                    ? "Terhubung"
                    : state.device?.deviceStatus === "pending_setup"
                      ? "Disiapkan"
                      : state.device?.deviceStatus || "offline"}
                </strong>
                <StatusChip
                  status={deviceBadge.status}
                  label={deviceBadge.label}
                />
              </article>
              <article className="metric-card guest-status-card">
                <span>Status layanan</span>
                <strong>{guestStatus.runtimeLabel}</strong>
                <StatusChip
                  status={guestRuntimeBadge.status}
                  label={guestStatus.runtimeChipLabel}
                />
              </article>
              <article className="metric-card guest-status-card">
                <span>Tautan akses</span>
                <strong>{guestStatus.publicLabel}</strong>
                <StatusChip status={guestStatus.publicStatus} />
              </article>
              <article className="metric-card guest-status-card">
                <span>Kesiapan akses</span>
                <strong>{guestStatus.headline}</strong>
                <StatusChip status={guestStatus.overallStatus} />
              </article>
              <DeviceUpdateCard
                deviceRecord={state.device}
                deviceStatus={state.device?.deviceStatus}
                busy={busy && commandModal.action === "update"}
                onUpdate={() => sendCommand("update")}
                showAction
              />
            </section>

            <article className="service-panel guest-service-panel">
              <div className="service-card-header">
                <div>
                  <strong>E-Rapor</strong>
                  <div className="mono">{state.device?.deviceId}</div>
                </div>
                <div className="service-status-group">
                  <StatusChip
                    status={deviceBadge.status}
                    label={deviceBadge.label}
                  />
                  <StatusChip
                    status={guestRuntimeBadge.status}
                    label={guestStatus.runtimeChipLabel}
                  />
                  <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
                </div>
              </div>

              <div className="guest-callout">
                <div>
                  <div className="section-eyebrow">Status utama</div>
                  <strong>{guestStatus.headline}</strong>
                </div>
                <p>{guestStatus.description}</p>
              </div>

              <div className="service-detail-grid guest-detail-grid">
                <div>
                  <span>Tautan E-Rapor</span>
                  <strong className="service-link mono">
                    {service?.public_url ? (
                      <a href={service.public_url} target="_blank" rel="noreferrer">
                        {service.public_url}
                      </a>
                    ) : (
                      "Belum tersedia"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Kondisi layanan</span>
                  <strong>{service?.desired_state === "running" ? "Siap dijalankan" : service?.desired_state || "-"}</strong>
                </div>
                <div>
                  <span>Terakhir diperbarui</span>
                  <strong>{formatRelativeTime(service?.last_ping)}</strong>
                </div>
                <div>
                  <span>Terakhir tersambung</span>
                  <strong>{formatRelativeTime(state.device?.lastSeen)}</strong>
                </div>
                <div>
                  <span>Kesiapan aplikasi</span>
                  <strong>{service?.location_status || "unknown"}</strong>
                </div>
                <div>
                  <span>Lokasi aplikasi</span>
                  <strong className="mono">{service?.resolved_path || "-"}</strong>
                </div>
              </div>

              {service?.location_details?.message ? (
                <div className="service-note">{service.location_details.message}</div>
              ) : null}
              {service?.last_error ? <div className="job-error">{service.last_error}</div> : null}

              <div className="guest-cta-row">
                <div className="panel-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => sendCommand("start")}
                  >
                    {busy ? "Memproses..." : "Mulai"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !isRunning}
                    onClick={() => sendCommand("stop")}
                  >
                    Hentikan
                  </button>
                  <a
                    className={`primary-button footer-link-button ${canOpenService ? "" : "button-disabled-link"}`}
                    href={canOpenService ? service.public_url : undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!canOpenService}
                    onClick={(event) => {
                      if (!canOpenService) {
                        event.preventDefault();
                      }
                    }}
                  >
                    Buka E-Rapor
                  </a>
                </div>
                <PublicLinkActions
                  url={service?.public_url || ""}
                  label={`Tautan E-Rapor untuk ${state.device?.deviceName || deviceId}`}
                  onActionComplete={setError}
                />
              </div>
            </article>
          </>
        )}
      </section>
      <SiteFooter />
      {commandModal.open ? (
        commandModal.action === "update" ? (
          <UpdateProgressModal
            open
            update={guestUpdate}
            title={commandModal.title}
            message={commandModal.message}
            onClose={() => setCommandModal((current) => ({ ...current, open: false }))}
          />
        ) : (
          <div className="guest-modal-backdrop" role="status" aria-live="polite">
          <div className="guest-modal-card">
            <div className="guest-modal-spinner" />
            <strong>{commandModal.title}</strong>
            <p>{commandModal.message}</p>
          </div>
          </div>
        )
      ) : null}
    </main>
  );
}

function PasswordResetScreen() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function bootstrapRecovery() {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      const searchParams = new URLSearchParams(search);
      const params = new URLSearchParams(hash);
      const code = searchParams.get("code");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      let recoveryError = null;

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        recoveryError = error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        recoveryError = error;
      } else {
        setError("Tautan verifikasi reset password tidak valid atau sudah kedaluwarsa.");
        setInfo("");
        return;
      }

      if (recoveryError) {
        setError("Tautan verifikasi reset password tidak valid atau sudah kedaluwarsa.");
        setInfo("");
        return;
      }

      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, RESET_PASSWORD_PATH);
      }
      setReady(true);
      setError("");
      setInfo("Verifikasi email berhasil. Silakan buat password baru untuk akun Anda.");
    }

    bootstrapRecovery();
  }, []);

  async function submit() {
    const passwordValue = String(password || "");
    const confirmPasswordValue = String(confirmPassword || "");

    if (passwordValue.length < 8) {
      setError("Password baru minimal 8 karakter.");
      setInfo("");
      return;
    }

    if (passwordValue !== confirmPasswordValue) {
      setError("Konfirmasi password tidak cocok.");
      setInfo("");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");
      const { error } = await supabase.auth.updateUser({ password: passwordValue });
      if (error) {
        throw error;
      }
      await supabase.auth.signOut({ scope: "global" }).catch(() =>
        supabase.auth.signOut({ scope: "local" }).catch(() => {})
      );
      clearStoredAuthArtifacts();
      setPassword("");
      setConfirmPassword("");
      setInfo("Password baru berhasil disimpan. Anda akan diarahkan ke halaman login.");
      window.setTimeout(() => {
        if (typeof window !== "undefined") {
          window.location.href = buildAuthPath();
        }
      }, 1200);
    } catch (error) {
      setError(formatPasswordUpdateError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card auth-simple-card">
        <div className="login-eyebrow">Reset Password</div>
        <h1>Buat password baru</h1>
        <p>
          Masukkan password baru untuk melanjutkan akses akun Anda.
        </p>
        <div className="login-form">
          <PasswordField
            label="Password baru"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
            disabled={busy}
            visible={showPasswords}
            onToggleVisibility={() => setShowPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy}
            visible={showPasswords}
            onToggleVisibility={() => setShowPasswords((current) => !current)}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="explorer-warning">{info}</div> : null}
          <button
            type="button"
            className="primary-button"
            disabled={busy || !password || !confirmPassword || !ready}
            onClick={submit}
          >
            {busy ? "Menyimpan..." : "Simpan password baru"}
          </button>
        </div>
      </div>
    </main>
  );
}

function DeviceList({ devices, selectedDeviceId, onSelect, now }) {
  return (
    <div className="device-list">
      {devices.map((device) => {
        const deviceBadge = getDeviceStatusBadgeModel(device.deviceStatus);
        return (
          <button
            key={device.deviceId}
            type="button"
            className={`device-list-item ${
              device.deviceId === selectedDeviceId ? "device-list-item-active" : ""
            }`}
            onClick={() => onSelect(device.deviceId)}
          >
            <div className="device-list-title">
              <strong>{device.deviceName}</strong>
              <StatusChip status={deviceBadge.status} label={deviceBadge.label} />
            </div>
            {device.deviceAlias ? <div className="device-list-meta">Nama tampilan</div> : null}
            <div className="device-list-meta mono">{device.deviceId}</div>
            <div className="device-list-foot">
              <span>{device.runningCount} aktif</span>
              <span>{device.fileJobCount} transfer</span>
              <span>{formatRelativeTime(device.deviceRecord?.last_seen, now)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DeviceUpdateCard({
  deviceRecord,
  deviceStatus = "offline",
  busy = false,
  onUpdate = null,
  showAction = false,
}) {
  const update = getDeviceUpdateModel(deviceRecord);
  const remoteUpdateSupported = supportsRemoteUpdate(deviceRecord);
  const statusLabel = busy && update.status !== "updating" ? "Update diminta" : update.label;
  const toneStatus = busy && update.status !== "updating" ? "reconnecting" : update.toneStatus;
  const canUpdate =
    showAction &&
    typeof onUpdate === "function" &&
    update.updateAvailable &&
    update.status !== "updating" &&
    remoteUpdateSupported &&
    deviceStatus === "online";
  const unsupportedUpdateMessage =
    showAction && update.updateAvailable && !remoteUpdateSupported
      ? `Update jarak jauh tersedia mulai agent v${REMOTE_UPDATE_MIN_VERSION}. Jalankan installer terbaru langsung di komputer ini.`
      : "";

  return (
    <article className="metric-card device-update-card">
      <span>Versi & update</span>
      <strong>{update.localVersion}</strong>
      <div className="device-update-lines">
        <span>Latest GitHub: {update.latestVersion}</span>
        <span>Dicek: {formatRelativeTime(update.checkedAt)}</span>
        {update.startedAt ? <span>Mulai update: {formatRelativeTime(update.startedAt)}</span> : null}
      </div>
      <div className="service-status-group">
        <StatusChip status={toneStatus} label={statusLabel} />
        {showAction && canUpdate ? (
          <ActionButton
            className="primary-button"
            busy={busy}
            disabled={busy}
            onClick={onUpdate}
          >
            Update Agent & Service
          </ActionButton>
        ) : null}
      </div>
      {update.error ? <div className="job-error">{update.error}</div> : null}
      {unsupportedUpdateMessage ? <div className="job-error">{unsupportedUpdateMessage}</div> : null}
    </article>
  );
}

function UpdateProgressModal({
  open,
  update,
  title = "Mengupdate Agent & Service",
  message = "Permintaan update dikirim. Agent akan menghentikan layanan, menjalankan installer silent, lalu hidup kembali otomatis.",
  onClose,
}) {
  if (!open) {
    return null;
  }

  const model = update || {
    status: "unchecked",
    label: "Update diminta",
    localVersion: "belum dilaporkan",
    latestVersion: "belum dilaporkan",
  };
  const progress =
    model.status === "current"
      ? 100
      : model.status === "failed"
        ? 100
        : model.status === "updating"
          ? 68
          : 34;
  const canClose = model.status !== "updating";
  const statusText =
    model.status === "current"
      ? "Update selesai. Buka ulang aplikasi atau halaman ini agar sesi dan tautan perangkat memakai data terbaru."
      : model.status === "failed"
        ? "Update gagal. Periksa pesan error dan log agent."
        : model.status === "updating"
          ? "Agent dan service sedang diupdate. Jangan gunakan layanan sampai agent aktif kembali, lalu buka ulang aplikasi atau halaman ini."
          : message;

  return (
    <div className="guest-modal-backdrop" role="status" aria-live="polite">
      <div className="guest-modal-card update-progress-card">
        <div className={`update-progress-orb tone-${model.status}`}>
          <div className="guest-modal-spinner" />
        </div>
        <div>
          <strong>{title}</strong>
          <p>{statusText}</p>
        </div>
        <div className="update-version-row">
          <span>Versi lokal: {model.localVersion}</span>
          <span>Latest GitHub: {model.latestVersion}</span>
        </div>
        <div className="update-progress-track" aria-label={`Progress update ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="update-step-list">
          <span className="update-step-active">Command diterima</span>
          <span className={model.status === "updating" || model.status === "current" ? "update-step-active" : ""}>
            Installer silent
          </span>
          <span className={model.status === "current" ? "update-step-active" : ""}>
            Agent aktif kembali
          </span>
        </div>
        {model.error ? <div className="job-error">{model.error}</div> : null}
        {canClose && typeof onClose === "function" ? (
          <div className="guest-modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              Tutup
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RootGrid({ roots, onOpen }) {
  if (roots.length === 0) {
    return <div className="empty-state">Belum ada lokasi berkas yang tersedia.</div>;
  }

  return (
    <div className="root-grid">
      {roots.map((root) => (
        <button
          key={`${root.device_id}:${root.root_key}`}
          type="button"
          className="root-card"
          onClick={() => onOpen(root.path)}
        >
          <div className="root-card-top">
            <strong>{root.label}</strong>
            <StatusChip
              status={root.metadata?.locationStatus || root.root_type}
              label={root.root_type.replace(/_/g, " ")}
            />
          </div>
          <div className="root-card-path mono">{root.path}</div>
          {root.metadata?.message ? <div className="root-card-note">{root.metadata.message}</div> : null}
        </button>
      ))}
    </div>
  );
}

function FileTable({
  currentPath,
  items,
  warnings,
  focusedPath,
  selectedPaths,
  onToggle,
  onOpen,
  onPreview,
  onOpenParent,
}) {
  if (!items || items.length === 0) {
    return (
      <div className="empty-state">
        Folder ini kosong atau belum berhasil dimuat.
      </div>
    );
  }

  const breadcrumbs = buildBreadcrumbs(currentPath);
  const folderCount = items.filter((item) => item.type === "directory").length;
  const fileCount = items.filter((item) => item.type === "file").length;

  return (
    <div className="explorer-shell">
      <div className="explorer-toolbar">
        <div className="explorer-breadcrumbs">
          <button type="button" className="utility-button" onClick={onOpenParent}>
            Naik
          </button>
          {breadcrumbs.map((crumb) => (
            <button
              key={crumb.path}
              type="button"
              className={`breadcrumb-chip ${
                crumb.path === currentPath ? "breadcrumb-chip-active" : ""
              }`}
              onClick={() => onOpen(crumb.path)}
            >
              {crumb.label}
            </button>
          ))}
        </div>
        <div className="explorer-summary">
          <span>{folderCount} folder</span>
          <span>{fileCount} file</span>
          {warnings?.length ? <span>{warnings.length} dilewati</span> : null}
        </div>
      </div>

      {warnings?.length ? (
        <div className="explorer-warning">
          Beberapa item tidak bisa dibaca karena sedang dikunci atau tidak dapat
          diakses. Explorer tetap menampilkan item lain yang berhasil dimuat.
        </div>
      ) : null}

      <div className="file-table-scroll">
        <div className="file-table">
          <div className="file-table-head">
            <span>Nama</span>
            <span>Jenis</span>
            <span>Ukuran</span>
            <span>Diubah</span>
            <span>Aksi</span>
          </div>
          {items.map((item) => {
            const selected = selectedPaths.includes(item.path);
            const isFocused = focusedPath && focusedPath === item.path;
            return (
              <div
                key={item.path}
                className={`file-row ${selected ? "file-row-selected" : ""} ${
                  isFocused ? "file-row-focused" : ""
                }`}
                onDoubleClick={() =>
                  item.type === "directory" ? onOpen(item.path) : onPreview(item)
                }
              >
                <div className="file-name-cell">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(item)}
                  />
                  <button
                    type="button"
                    className={`file-glyph file-glyph-${item.type}`}
                    onClick={() =>
                      item.type === "directory" ? onOpen(item.path) : onPreview(item)
                    }
                  >
                    {getItemGlyph(item)}
                  </button>
                  <div className="file-name-content">
                    <button
                      type="button"
                      className="file-link"
                      onClick={() =>
                        item.type === "directory" ? onOpen(item.path) : onPreview(item)
                      }
                    >
                      {item.name}
                    </button>
                    <div className="file-subpath mono">{item.path}</div>
                  </div>
                </div>
                <span>{getFileKindLabel(item)}</span>
                <span>{item.type === "directory" ? "-" : formatBytes(item.size)}</span>
                <span>{formatDate(item.modifiedAt)}</span>
                <button
                  type="button"
                  className={`utility-button ${item.type === "directory" ? "open-folder-button" : ""}`}
                  onClick={() =>
                    item.type === "directory" ? onOpen(item.path) : onPreview(item)
                  }
                >
                  {item.type === "directory" ? "Buka folder" : "Lihat"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function JobList({ jobs, onDownload, onPromote, onCancel }) {
  if (jobs.length === 0) {
    return <div className="empty-state">Belum ada aktivitas berkas untuk perangkat ini.</div>;
  }

  return (
    <div className="job-stack">
      {jobs.map((job) => (
        <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
          <div className="job-card-top">
            <div>
              <strong>{getActivityLabel(job.job_type)}</strong>
              <div className="mono">#{job.id}</div>
            </div>
            <StatusChip status={job.status} />
          </div>
          <div className="job-card-path mono">{job.source_path || job.destination_path || "-"}</div>
          {job.result?.fileName ? (
            <div className="job-card-path mono">{job.result.fileName}</div>
          ) : null}
          <div className="job-card-meta">
            <span>{formatDate(job.created_at)}</span>
            <span>{job.progress_total ? `${job.progress_current}/${job.progress_total}` : "proses belum tersedia"}</span>
            <span>{job.delivery_mode === "temp" ? "Sementara" : job.delivery_mode || "-"}</span>
            {Array.isArray(job.result?.parts) && job.result.parts.length > 1 ? (
              <span>{job.result.parts.length} parts</span>
            ) : null}
            {job.result?.size ? <span>{formatBytes(job.result.size)}</span> : null}
          </div>
          {getJobStatusDetail(job) ? (
            <div className="explorer-warning">{getJobStatusDetail(job)}</div>
          ) : null}
          {job.error ? <div className="job-error">{job.error}</div> : null}
          <div className="job-actions">
            {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
              <button type="button" className="primary-button" onClick={() => onDownload(job)}>
                {Array.isArray(job.result?.parts) && job.result.parts.length > 1
                  ? "Unduh bagian"
                  : "Unduh"}
              </button>
            ) : null}
            {job.status === "completed" &&
            job.delivery_mode === "temp" &&
            job.artifact_bucket &&
            !Array.isArray(job.result?.parts) ? (
              <button type="button" className="secondary-button" onClick={() => onPromote(job)}>
                Simpan permanen
              </button>
            ) : null}
            {["pending", "running"].includes(job.status) ? (
              <button type="button" className="secondary-button" onClick={() => onCancel(job)}>
                Batalkan
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ArtifactInventory({
  artifacts,
  deviceOptions,
  bucketFilter,
  deviceFilter,
  search,
  busyAction,
  onBucketFilter,
  onDeviceFilter,
  onSearch,
  onRefresh,
  onDownload,
  onDelete,
}) {
  const buckets = ["agent-temp-artifacts", "agent-archives", "agent-preview-cache", "admin-upload-staging"];

  return (
    <article className="jobs-panel artifact-inventory-panel">
      <div className="panel-heading-row">
        <div>
          <h3>Bucket & Arsip Berkas</h3>
          <div className="root-card-note">Semua artifact storage dengan nama ramah, bucket, dan device asal.</div>
        </div>
        <div className="panel-actions">
          <ActionButton
            className="secondary-button"
            busy={busyAction === "artifacts:refresh"}
            onClick={onRefresh}
          >
            Segarkan bucket
          </ActionButton>
        </div>
      </div>

      <div className="artifact-filter-bar">
        <label>
          <span>Bucket</span>
          <select value={bucketFilter} onChange={(event) => onBucketFilter(event.target.value)}>
            <option value="all">Semua bucket</option>
            {buckets.map((bucket) => (
              <option key={bucket} value={bucket}>{bucket}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Device</span>
          <select value={deviceFilter} onChange={(event) => onDeviceFilter(event.target.value)}>
            <option value="all">Semua device</option>
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>{device.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Cari</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Nama file, path, bucket, device"
          />
        </label>
      </div>

      {artifacts.length === 0 ? (
        <div className="empty-state">Belum ada artifact yang cocok dengan filter ini.</div>
      ) : (
        <div className="artifact-table">
          {artifacts.map((artifact) => {
            const downloadJob = {
              id: artifact.jobId || artifact.id,
              artifact_bucket: artifact.bucket,
              artifact_object_key: artifact.objectKey,
              result: {
                fileName: artifact.fileName,
                size: artifact.size,
              },
            };
            const canDownload = artifact.bucket && artifact.objectKey && artifact.status !== "deleted";
            return (
              <article key={artifact.id || `${artifact.bucket}:${artifact.objectKey}`} className={`artifact-row tone-${statusTone(artifact.status)}`}>
                <div className="artifact-main">
                  <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                  <span className="mono">{artifact.sourcePath || artifact.objectKey || "-"}</span>
                </div>
                <div className="artifact-meta">
                  <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                  <span>{artifact.bucket}</span>
                  <span>{formatBytes(Number(artifact.size || 0))}</span>
                  <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                </div>
                <div className="artifact-actions">
                  <StatusChip status={artifact.status || "unknown"} />
                  {canDownload ? (
                    <ActionButton className="primary-button" onClick={() => onDownload(downloadJob)}>
                      Unduh
                    </ActionButton>
                  ) : null}
                  {canDownload ? (
                    <ActionButton
                      className="danger-button"
                      busy={busyAction === `artifact-delete:${artifact.id || artifact.objectKey}`}
                      onClick={() => onDelete(artifact)}
                    >
                      Hapus
                    </ActionButton>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
}

function DeviceAliasModal({
  device,
  value,
  onChange,
  onClose,
  onSave,
  busy,
}) {
  if (!device) {
    return null;
  }

  return (
    <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-alias-title">
      <div className="guest-modal-card dashboard-modal-card">
        <strong id="device-alias-title">Ubah nama tampilan perangkat</strong>
        <p>
          Nama tampilan hanya berlaku untuk akun Anda. Nama asli perangkat tetap tersimpan sebagai{" "}
          <span className="mono">{device.deviceRecord?.device_name || device.deviceId}</span>.
        </p>
        <label className="modal-field">
          <span>Nama tampilan</span>
          <input
            value={value}
            maxLength={80}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Contoh: Server TU, Laptop Operator, PC Lab"
            autoFocus
          />
        </label>
        <div className="guest-modal-actions">
          <ActionButton className="secondary-button" disabled={busy} onClick={onClose}>
            Batal
          </ActionButton>
          <ActionButton className="primary-button" busy={busy} onClick={onSave}>
            Simpan
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function TransferHistoryModal({
  open,
  loading,
  history,
  device,
  deviceId,
  onClose,
  onDownload,
}) {
  if (!open) {
    return null;
  }

  const jobs = history?.jobs || [];
  const audits = history?.auditLogs || [];
  const contextLabel = device?.deviceName || deviceId || "Semua perangkat";

  return (
    <div className="guest-modal-backdrop modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="transfer-history-title">
      <div className="guest-modal-card transfer-modal-card">
        <div className="modal-title-row">
          <div>
            <strong id="transfer-history-title">Riwayat Berkas</strong>
            <p>Berkas yang pernah diproses untuk <span className="mono">{contextLabel}</span>.</p>
          </div>
          <ActionButton className="secondary-button" onClick={onClose}>
            Tutup
          </ActionButton>
        </div>
        {loading ? (
          <div className="empty-state compact-empty">Memuat riwayat berkas...</div>
        ) : !jobs.length && !audits.length ? (
          <div className="empty-state compact-empty">Belum ada riwayat berkas untuk perangkat ini.</div>
        ) : (
          <div className="transfer-history-grid">
            <section className="transfer-files-section">
              <h4>Berkas Perangkat</h4>
              <div className="job-stack">
                {jobs.map((job) => (
                  <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
                    <div className="job-card-top">
                      <div>
                        <strong>{getActivityLabel(job.job_type || "transfer")}</strong>
                        <div className="mono">Aktivitas #{job.id} · {job.device_id}</div>
                      </div>
                      <StatusChip status={job.status} />
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(job.created_at)}</span>
                      <span>{job.delivery_mode === "temp" || !job.delivery_mode ? "Sementara" : job.delivery_mode}</span>
                      <span>{formatBytes(Number(job.artifact_size || job.result?.size || 0))}</span>
                    </div>
                    <div className="root-card-note">
                      {job.source_path || job.destination_path || job.result?.fileName || "Detail path tidak tersedia."}
                    </div>
                    {job.artifact_bucket && job.artifact_object_key ? (
                      <div className="job-actions">
                        <ActionButton className="primary-button" onClick={() => onDownload(job)}>
                          Unduh berkas
                        </ActionButton>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
            <section className="transfer-audit-section">
              <h4>Catatan</h4>
              <div className="job-stack">
                {audits.map((audit) => (
                  <article key={audit.id} className="job-card">
                    <div className="job-card-top">
                      <div>
                        <strong>{getActivityLabel(audit.action || "activity")}</strong>
                        <div className="mono">{audit.device_id} · {audit.job_id ? `Aktivitas #${audit.job_id}` : "sistem"}</div>
                      </div>
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(audit.created_at)}</span>
                      <span>{audit.target_path || "target tidak tersedia"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const currentHash = typeof window !== "undefined" ? window.location.hash : "";
  const normalizedPathname = normalizePathname(currentPathname);
  const guestDeviceId =
    typeof window !== "undefined"
      ? decodeURIComponent(normalizedPathname.match(/^\/guest\/([^/]+)$/)?.[1] || "")
      : "";
  const currentParams =
    typeof window !== "undefined" ? new URLSearchParams(currentSearch) : new URLSearchParams();
  const hasRecoveryCode =
    typeof window !== "undefined" &&
    currentParams.has("code") &&
    [AUTH_PATH, RESET_PASSWORD_PATH, LEGACY_RESET_PASSWORD_PATH].includes(normalizedPathname);
  const resetPasswordMode =
    normalizedPathname === RESET_PASSWORD_PATH ||
    normalizedPathname === LEGACY_RESET_PASSWORD_PATH ||
    hasRecoveryCode ||
    /(^|[&#])type=recovery(?:[&#]|$)/.test(currentHash);
  const requestedAuthMode =
    typeof window !== "undefined" ? currentParams.get("mode") : "";
  const requestedGuestLinkDeviceId =
    typeof window !== "undefined" ? currentParams.get("linkDeviceId") || "" : "";
  const requestedGuestReturnDeviceId =
    typeof window !== "undefined"
      ? currentParams.get("guestDeviceId") || requestedGuestLinkDeviceId
      : "";
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState(
    requestedAuthMode === "register" ? "register" : "login"
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerRole, setRegisterRole] = useState("operator");
  const [registerMode, setRegisterMode] = useState("referral_code");
  const [registerReferralCode, setRegisterReferralCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [dashboardInfo, setDashboardInfo] = useState("");
  const [pendingGuestLinkDeviceId, setPendingGuestLinkDeviceId] = useState(
    requestedGuestLinkDeviceId
  );
  const [guestReturnDeviceId, setGuestReturnDeviceId] = useState(
    requestedGuestReturnDeviceId
  );
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [authPolicy, setAuthPolicy] = useState({
    operatorAutoApproveHours: 24,
    environmentUserAutoApproveHours: 8,
    standaloneUserApprovalMode: "manual",
    standaloneUserAutoApproveHours: 24,
    maintenanceIntervalMinutes: 15,
    passwordResetRedirectUrl: buildResetPasswordUrl(),
  });
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [fileJobs, setFileJobs] = useState([]);
  const [storageArtifacts, setStorageArtifacts] = useState([]);
  const [roots, setRoots] = useState([]);
  const [deviceAliases, setDeviceAliases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [appRoute, setAppRoute] = useState(() =>
    typeof window === "undefined" ? { section: "overview", deviceId: "" } : parseAppRoute(window.location.pathname)
  );
  const [now, setNow] = useState(Date.now());
  const [busyAction, setBusyAction] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [directoryJobId, setDirectoryJobId] = useState(null);
  const [directoryResult, setDirectoryResult] = useState(null);
  const [previewJobId, setPreviewJobId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [channelState, setChannelState] = useState("connecting");
  const [logLevelFilter, setLogLevelFilter] = useState("all");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createRole, setCreateRole] = useState("operator");
  const [createAssignedDeviceId, setCreateAssignedDeviceId] = useState("");
  const [createApproveImmediately, setCreateApproveImmediately] = useState(true);
  const [aliasModalDeviceId, setAliasModalDeviceId] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(false);
  const [transferHistory, setTransferHistory] = useState({ jobs: [], auditLogs: [] });
  const [artifactBucketFilter, setArtifactBucketFilter] = useState("all");
  const [artifactDeviceFilter, setArtifactDeviceFilter] = useState("all");
  const [artifactSearch, setArtifactSearch] = useState("");
  const [updateModal, setUpdateModal] = useState({
    open: false,
    deviceId: "",
    title: "Mengupdate Agent & Service",
    message: "",
    error: "",
  });
  const fileInputRef = useRef(null);

  function resetAuthFormState(nextMode = "login") {
    setAuthMode(nextMode);
    setLoginEmail("");
    setLoginPassword("");
    setRegisterDisplayName("");
    setRegisterRole("operator");
    setRegisterMode("referral_code");
    setRegisterReferralCode("");
  }

  function resetAuthenticatedState() {
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setAccounts([]);
    setEnvironments([]);
    setServices([]);
    setLogs([]);
    setFileJobs([]);
    setStorageArtifacts([]);
    setRoots([]);
    setDeviceAliases([]);
    setLoading(true);
    setError("");
    setDashboardInfo("");
    setSelectedDeviceId("all");
    setAppRoute({ section: "overview", deviceId: "" });
    setBusyAction("");
    setCurrentPath("");
    setDirectoryJobId(null);
    setDirectoryResult(null);
    setPreviewJobId(null);
    setPreviewResult(null);
    setSelectedPaths([]);
    setChannelState("connecting");
    setLogLevelFilter("all");
    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
    setAliasModalDeviceId("");
    setUpdateModal({
      open: false,
      deviceId: "",
      title: "Mengupdate Agent & Service",
      message: "",
      error: "",
    });
    setAliasDraft("");
    setTransferHistoryOpen(false);
    setTransferHistoryLoading(false);
    setTransferHistory({ jobs: [], auditLogs: [] });
    setArtifactBucketFilter("all");
    setArtifactDeviceFilter("all");
    setArtifactSearch("");
  }

  function clearGuestLinkRequest() {
    setPendingGuestLinkDeviceId("");
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("linkDeviceId");
    params.delete("mode");
    if (guestReturnDeviceId) {
      params.set("guestDeviceId", guestReturnDeviceId);
    }
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`
    );
  }

  const selectedTab = appRoute.section;

  function navigateRoute(section, params = {}, options = {}) {
    const nextRoute = {
      section: DASHBOARD_SECTIONS.has(section) ? section : "overview",
      deviceId: section === "devices" ? String(params.deviceId || "").trim() : "",
    };
    setAppRoute(nextRoute);
    if (nextRoute.deviceId) {
      setSelectedDeviceId(nextRoute.deviceId);
    } else if (nextRoute.section === "devices" && params.selectAll) {
      setSelectedDeviceId("all");
    }

    if (typeof window === "undefined") {
      return;
    }

    const nextPath = buildRoutePath(nextRoute.section, { deviceId: nextRoute.deviceId });
    const routeSearchParams = new URLSearchParams(window.location.search);
    routeSearchParams.delete("mode");
    routeSearchParams.delete("linkDeviceId");
    const nextSearch = routeSearchParams.toString();
    const nextUrl = `${nextPath}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    if (window.location.pathname !== nextPath) {
      window.history[options.replace ? "replaceState" : "pushState"](null, "", nextUrl);
    }
  }

  function setSelectedTab(section) {
    navigateRoute(section);
  }

  useEffect(() => {
    if (resetPasswordMode) {
      setAuthLoading(false);
      setSession(null);
      setProfile(null);
      return undefined;
    }

    if (guestDeviceId) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    const fallbackTimer =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (active) {
              setAuthLoading(false);
            }
          }, 1500)
        : null;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) {
          return;
        }
        if (sessionError) {
          throw sessionError;
        }
        setSession(data.session || null);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        clearStoredAuthArtifacts();
        setSession(null);
      })
      .finally(() => {
        if (!active) {
          return;
        }
        if (fallbackTimer) {
          window.clearTimeout(fallbackTimer);
        }
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (resetPasswordMode && event !== "SIGNED_OUT") {
        setAuthLoading(false);
        return;
      }

      if (event === "SIGNED_OUT") {
        resetAuthenticatedState();
        resetAuthFormState("login");
      } else {
        setSession(nextSession || null);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setAuthError("");
      }
      setAuthInfo("");
      setAuthLoading(false);
    });

    return () => {
      active = false;
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      subscription.unsubscribe();
    };
  }, [guestDeviceId, resetPasswordMode]);

  useEffect(() => {
    if (typeof window === "undefined" || guestDeviceId || resetPasswordMode) {
      return;
    }

    const authParams = {};
    if (authMode === "register") {
      authParams.mode = "register";
    }
    if (pendingGuestLinkDeviceId) {
      authParams.linkDeviceId = pendingGuestLinkDeviceId;
    }
    if (guestReturnDeviceId) {
      authParams.guestDeviceId = guestReturnDeviceId;
    }

    const currentPath = normalizePathname(window.location.pathname);
    if (session) {
      if (currentPath === ROOT_PATH || currentPath === AUTH_PATH) {
        window.history.replaceState(null, "", buildRoutePath("overview"));
      }
      return;
    }

    if (authLoading) {
      return;
    }

    if (currentPath === ROOT_PATH || currentPath.startsWith("/dashboard")) {
      window.history.replaceState(null, "", buildAuthPath(authParams));
    }
  }, [
    authLoading,
    authMode,
    guestDeviceId,
    guestReturnDeviceId,
    pendingGuestLinkDeviceId,
    resetPasswordMode,
    session,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || guestDeviceId) {
      return undefined;
    }

    const handlePopState = () => {
      const nextRoute = parseAppRoute(window.location.pathname);
      setAppRoute(nextRoute);
      if (nextRoute.section === "devices" && nextRoute.deviceId) {
        setSelectedDeviceId(nextRoute.deviceId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [guestDeviceId]);

  useEffect(() => {
    if (!session || guestDeviceId || resetPasswordMode) {
      setProfile(null);
      return;
    }

    let active = true;
    setProfileLoading(true);
    invokeEdgeFunction("account-access", { action: "sessionProfile" }, session)
      .then((data) => {
        if (!active) {
          return;
        }
        setProfile(data.profile || null);
        setAuthError("");
        setProfileLoading(false);
      })
      .catch((profileError) => {
        if (!active) {
          return;
        }
        if (isInvalidSessionError(profileError)) {
          setAuthError(formatEdgeFunctionError(profileError));
          setProfile(null);
          setProfileLoading(false);
          setSession(null);
          resetAuthFormState("login");
          supabase.auth.signOut().catch(() => {});
          clearStoredAuthArtifacts();
          return;
        }
        setAuthError(formatEdgeFunctionError(profileError));
        setProfile(null);
        setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, guestDeviceId, resetPasswordMode]);

  useEffect(() => {
    if (registerRole !== "user") {
      setRegisterMode("referral_code");
      setRegisterReferralCode("");
    }
  }, [registerRole]);

  useEffect(() => {
    if (profile?.role === "operator") {
      setCreateRole("user");
      setCreateApproveImmediately(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!pendingGuestLinkDeviceId || !profile || profile.status !== "approved") {
      return;
    }
    if (!["user", "operator"].includes(profile.role)) {
      setDashboardInfo("Penautan perangkat tersedia untuk akun User atau Operator.");
      clearGuestLinkRequest();
    }
  }, [pendingGuestLinkDeviceId, profile]);

  async function loadAll(background = false) {
    if (!session || guestDeviceId) {
      return;
    }

    if (!background) {
      setLoading(true);
    }

    try {
      const [dashboard, artifactPayload] = await Promise.all([
        invokeAdmin("listDashboard"),
        profile?.role === "super_admin"
          ? invokeAdmin("listStorageArtifacts")
          : Promise.resolve({ artifacts: [] }),
      ]);
      startTransition(() => {
        setServices(dashboard.services || []);
        setLogs(dashboard.logs || []);
        setFileJobs(dashboard.fileJobs || []);
        setStorageArtifacts(artifactPayload.artifacts || []);
        setRoots(dashboard.roots || []);
        setAccounts(dashboard.accounts || []);
        setEnvironments(dashboard.environments || []);
        setDeviceAliases(dashboard.deviceAliases || []);
        if (dashboard.authPolicy) {
          setAuthPolicy((current) => ({ ...current, ...dashboard.authPolicy }));
        }
      });
      setChannelState("ready");
      setError("");
    } catch (loadError) {
      setChannelState("error");
      setError(formatEdgeFunctionError(loadError));
    }

    if (!background) {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !profile || guestDeviceId) {
      return undefined;
    }

    loadAll();
    const refreshId = window.setInterval(() => {
      loadAll(true);
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [session, profile, guestDeviceId]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId) {
      return;
    }
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      setSelectedDeviceId("all");
    }
  }, [services, selectedDeviceId, appRoute]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    const allowedSections = getAllowedDashboardSections(profile.role);
    if (!allowedSections.has(selectedTab)) {
      setDashboardInfo("Halaman tersebut tidak tersedia untuk role akun ini.");
      navigateRoute("overview", {}, { replace: true });
      return;
    }
    if (
      typeof window !== "undefined" &&
      (window.location.pathname === "/dashboard" || !window.location.pathname.startsWith("/dashboard"))
    ) {
      navigateRoute("overview", {}, { replace: true });
    }
  }, [profile, selectedTab]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId && appRoute.deviceId !== selectedDeviceId) {
      setSelectedDeviceId(appRoute.deviceId);
    }
  }, [appRoute, selectedDeviceId]);

  const deviceEntries = useMemo(() => {
    const grouped = new Map();
    const aliasMap = new Map(
      deviceAliases.map((entry) => [String(entry.device_id || ""), String(entry.alias || "").trim()])
    );
    for (const row of services) {
      const deviceRecord = Array.isArray(row.devices) ? row.devices[0] : row.devices;
      const deviceStatus = deriveDeviceStatus(deviceRecord);
      const serviceStatus = deriveServiceStatus(row, deviceStatus);
      const rawDeviceName = deviceRecord?.device_name || row.device_id;
      const deviceAlias = aliasMap.get(String(row.device_id)) || "";

      if (!grouped.has(row.device_id)) {
        grouped.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: deviceAlias || rawDeviceName,
          deviceAlias,
          rawDeviceName,
          deviceStatus,
          deviceRecord,
          services: [],
        });
      }

      grouped.get(row.device_id).services.push({
        ...row,
        serviceStatus,
      });
    }

    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      runningCount: entry.services.filter((service) => service.serviceStatus === "running").length,
      fileJobCount: fileJobs.filter(
        (job) =>
          job.device_id === entry.deviceId &&
          ["pending", "running"].includes(job.status)
      ).length,
      issueCount: entry.services.filter(
        (service) =>
          ["error", "offline", "blocked", "missing", "partial"].includes(service.serviceStatus) ||
          ["missing", "partial"].includes(service.location_status)
      ).length,
    }));
  }, [services, fileJobs, deviceAliases]);

  const selectedDevice =
    appRoute.section === "devices" && appRoute.deviceId
      ? deviceEntries.find((entry) => entry.deviceId === appRoute.deviceId) || null
      : selectedDeviceId === "all"
      ? deviceEntries[0] || null
      : deviceEntries.find((entry) => entry.deviceId === selectedDeviceId) || null;
  const aliasModalDevice =
    deviceEntries.find((entry) => entry.deviceId === aliasModalDeviceId) || null;
  const updateModalDevice =
    deviceEntries.find((entry) => entry.deviceId === updateModal.deviceId) || null;
  const updateModalModel = updateModalDevice
    ? {
        ...getDeviceUpdateModel(updateModalDevice.deviceRecord),
        ...(updateModal.error ? { status: "failed", label: "Gagal update", error: updateModal.error } : {}),
      }
    : {
        status: updateModal.error ? "failed" : "available",
        label: updateModal.error ? "Gagal update" : "Update diminta",
        localVersion: "belum dilaporkan",
        latestVersion: "belum dilaporkan",
        error: updateModal.error,
      };
  const autoUpdatingDevice =
    deviceEntries.find((entry) => getDeviceUpdateModel(entry.deviceRecord).status === "updating") ||
    null;
  const selectedGuestUrl = selectedDevice ? buildGuestUrl(selectedDevice.deviceId) : "";
  const selectedDeviceBadge = getDeviceStatusBadgeModel(selectedDevice?.deviceStatus || "offline");

  useEffect(() => {
    if (!autoUpdatingDevice) {
      return;
    }

    setUpdateModal((current) => {
      if (current.open && current.deviceId === autoUpdatingDevice.deviceId && !current.error) {
        return current;
      }

      return {
        open: true,
        deviceId: autoUpdatingDevice.deviceId,
        title: "Mengupdate Agent & Service",
        message: "Pembaruan otomatis sedang berjalan. Agent akan hidup kembali setelah installer selesai.",
        error: "",
      };
    });
  }, [autoUpdatingDevice?.deviceId]);

  useEffect(() => {
    if (createRole !== "user") {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    const availableDeviceIds = deviceEntries.map((entry) => entry.deviceId).filter(Boolean);
    if (!availableDeviceIds.length) {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    if (createAssignedDeviceId && availableDeviceIds.includes(createAssignedDeviceId)) {
      return;
    }

    const preferredDeviceId =
      (selectedDevice?.deviceId && availableDeviceIds.includes(selectedDevice.deviceId)
        ? selectedDevice.deviceId
        : availableDeviceIds[0]) || "";

    if (preferredDeviceId !== createAssignedDeviceId) {
      setCreateAssignedDeviceId(preferredDeviceId);
    }
  }, [createRole, createAssignedDeviceId, deviceEntries, selectedDevice]);

  const visibleServices = useMemo(() => {
    if (!selectedDevice) {
      return [];
    }

    if (profile?.role === "user") {
      return selectedDevice.services.filter((service) => service.service_name === "rapor");
    }

    return selectedDevice.services;
  }, [selectedDevice, profile]);

  const selectedDeviceJobs = useMemo(
    () =>
      selectedDevice
        ? fileJobs.filter((job) => job.device_id === selectedDevice.deviceId)
        : [],
    [fileJobs, selectedDevice]
  );

  const artifactDeviceOptions = useMemo(() => {
    const options = new Map();
    for (const artifact of storageArtifacts) {
      const deviceId = String(artifact.deviceId || artifact.device_id || "").trim();
      if (!deviceId) {
        continue;
      }
      options.set(deviceId, artifact.deviceName || deviceId);
    }
    return Array.from(options.entries()).map(([id, label]) => ({ id, label }));
  }, [storageArtifacts]);

  const visibleStorageArtifacts = useMemo(() => {
    const query = artifactSearch.trim().toLowerCase();
    return storageArtifacts.filter((artifact) => {
      const bucket = String(artifact.bucket || "").trim();
      const deviceId = String(artifact.deviceId || artifact.device_id || "").trim();
      if (artifactBucketFilter !== "all" && bucket !== artifactBucketFilter) {
        return false;
      }
      if (artifactDeviceFilter !== "all" && deviceId !== artifactDeviceFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        artifact.fileName,
        artifact.objectKey,
        artifact.sourcePath,
        artifact.deviceName,
        artifact.bucket,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(query));
    });
  }, [artifactBucketFilter, artifactDeviceFilter, artifactSearch, storageArtifacts]);

  const selectedDeviceRoots = useMemo(
    () =>
      selectedDevice
        ? roots.filter((root) => root.device_id === selectedDevice.deviceId)
        : [],
    [roots, selectedDevice]
  );

  useEffect(() => {
    if (!directoryJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === directoryJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed" && job.result) {
      setDirectoryResult(job.result);
      if (job.result.path) {
        setCurrentPath(job.result.path);
      }
      setSelectedPaths([]);
      setDirectoryJobId(null);
    } else if (job.status === "failed") {
      setError(job.error || "Directory listing failed.");
      setDirectoryJobId(null);
    }
  }, [directoryJobId, fileJobs]);

  useEffect(() => {
    if (!previewJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === previewJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed" && job.result) {
      setPreviewResult(job.result);
      setPreviewJobId(null);
    } else if (job.status === "failed") {
      setError(job.error || "Pratinjau belum berhasil dimuat.");
      setPreviewJobId(null);
    }
  }, [previewJobId, fileJobs]);

  async function invokeAdmin(action, payload = {}) {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-ops", {
      body: { action, ...payload },
    });

    if (invokeError) {
      throw invokeError;
    }

    if (!data?.ok) {
      throw new Error(data?.error || "Admin operation failed.");
    }

    return data;
  }

  async function createJobFallback(jobType, payload = {}) {
    const { data, error: insertError } = await supabase
      .from("file_jobs")
      .insert({
        device_id: selectedDevice.deviceId,
        requested_by: session.user.id,
        job_type: jobType,
        delivery_mode: payload.deliveryMode || "temp",
        source_path: payload.sourcePath || null,
        destination_path: payload.destinationPath || null,
        selection: payload.selection || [],
        options: payload.options || {},
        status: "pending",
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    return { job: data };
  }

  async function signIn() {
    setAuthBusy(true);
    setAuthError("");
    setAuthInfo("");
    try {
      const normalizedEmail = normalizeLoginEmail(loginEmail);
      const normalizedPassword = normalizeLoginPassword(loginPassword);

      if (authMode === "register") {
        await invokeEdgeFunction("account-access", {
          action: "register",
          email: normalizedEmail,
          password: normalizedPassword,
          displayName: registerDisplayName,
          role: registerRole,
          registrationMode: registerRole === "user" ? registerMode : "open_operator_signup",
          referralCode: registerRole === "user" ? registerReferralCode : "",
        });
        setAuthInfo(
          "Pendaftaran berhasil diterima. Masuk dengan akun yang sama untuk memantau status persetujuan."
        );
        setAuthMode("login");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        });

        if (signInError) {
          setAuthError(formatSignInError(signInError));
        }
      }
    } catch (authActionError) {
      setAuthError(formatEdgeFunctionError(authActionError));
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendForgotPassword() {
    try {
      setAuthBusy(true);
      setAuthError("");
      setAuthInfo("");
      const redirectTo = buildResetPasswordUrl();
      const normalizedEmail = normalizeLoginEmail(loginEmail);
      await invokeEdgeFunction("account-access", {
        action: "forgotPassword",
        email: normalizedEmail,
        redirectTo,
      });

      setAuthInfo("Tautan untuk mengganti password sudah dikirim ke email Anda. Buka email tersebut, verifikasi tautan, lalu buat password baru.");
    } catch (forgotError) {
      setAuthError(formatEdgeFunctionError(forgotError));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const returnDeviceId = String(guestReturnDeviceId || pendingGuestLinkDeviceId || "").trim();
    setAuthBusy(true);
    setAuthError("");
    setAuthInfo("");
    setDashboardInfo("");
    resetAuthenticatedState();
    try {
      const globalResult = await supabase.auth.signOut({ scope: "global" });
      if (globalResult.error) {
        await supabase.auth.signOut({ scope: "local" });
      }
    } catch (_error) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    } finally {
      clearStoredAuthArtifacts();
      resetAuthFormState("login");
      setAuthBusy(false);
      if (typeof window !== "undefined") {
        if (returnDeviceId) {
          window.location.href = buildGuestPath(returnDeviceId);
        } else {
          window.location.href = buildAuthPath();
        }
      }
    }
  }

  async function queueCommand(deviceId, serviceName, action) {
    setBusyAction(`${deviceId}:${serviceName || "device"}:${action}`);
    setError("");
    if (action === "update") {
      setUpdateModal({
        open: true,
        deviceId,
        title: "Mengupdate Agent & Service",
        message: "Permintaan update dikirim. Agent akan menjalankan installer silent saat command diterima.",
        error: "",
      });
    }
    try {
      await invokeAdmin("queueCommand", {
        deviceId,
        serviceName,
        commandAction: action,
      });
      loadAll(true);
      if (action === "update") {
        setUpdateModal((current) => ({
          ...current,
          message: "Update diminta. Status akan berubah ke Sedang update saat agent mulai memasang versi baru.",
          error: "",
        }));
      }
    } catch (commandError) {
      const message = formatEdgeFunctionError(commandError);
      setError(message);
      if (action === "update") {
        setUpdateModal((current) => ({
          ...current,
          open: true,
          title: "Update gagal dikirim",
          message,
          error: message,
        }));
      }
    } finally {
      setBusyAction("");
    }
  }

  async function updateDeviceStatus(deviceId, status) {
    setBusyAction(`${deviceId}:${status}`);
    setError("");
    try {
      await invokeAdmin("updateDeviceStatus", { deviceId, status });
      loadAll(true);
    } catch (statusError) {
      setError(formatEdgeFunctionError(statusError));
    } finally {
      setBusyAction("");
    }
  }

  async function createFileJob(jobType, payload = {}) {
    if (!selectedDevice) {
      return null;
    }

    setBusyAction(`job:${jobType}`);
    setError("");
    try {
      let data;
      try {
        data = await invokeAdmin("createJob", {
          deviceId: selectedDevice.deviceId,
          jobType,
          ...payload,
        });
      } catch (functionError) {
        data = await createJobFallback(jobType, payload);
      }
      setBusyAction("");
      loadAll(true);
      return data.job;
    } catch (jobError) {
      setBusyAction("");
      setError(formatEdgeFunctionError(jobError));
      return null;
    }
  }

  async function copyGuestLink(deviceId) {
    try {
      setBusyAction(`guest:${deviceId}`);
      const data = await invokeAdmin("syncGuestLink", { deviceId });
      await copyTextToClipboard(data.guestUrl);
      setError("");
      loadAll(true);
    } catch (copyError) {
      setError(formatEdgeFunctionError(copyError));
    } finally {
      setBusyAction("");
    }
  }

  async function handleAccountAction(action, payload = {}) {
    try {
      setBusyAction(`account:${action}`);
      await invokeAdmin(action, payload);
      await loadAll(true);
    } catch (accountError) {
      setError(formatEdgeFunctionError(accountError));
    } finally {
      setBusyAction("");
    }
  }

  async function confirmGuestDeviceLink() {
    const deviceId = String(pendingGuestLinkDeviceId || "").trim();
    if (!deviceId) {
      return;
    }

    try {
      setBusyAction(`guest-link:${deviceId}`);
      setError("");
      setDashboardInfo("");
      await invokeAdmin("linkGuestDevice", { deviceId });
      setSelectedDeviceId(deviceId);
      clearGuestLinkRequest();
      await loadAll(true);
      setDashboardInfo("Perangkat berhasil ditautkan ke akun ini.");
    } catch (linkError) {
      setError(formatEdgeFunctionError(linkError));
    } finally {
      setBusyAction("");
    }
  }

  function openAliasModal(device) {
    setAliasModalDeviceId(device.deviceId);
    setAliasDraft(device.deviceAlias || "");
  }

  async function saveDeviceAlias() {
    if (!aliasModalDevice) {
      return;
    }

    try {
      setBusyAction(`alias:${aliasModalDevice.deviceId}`);
      setError("");
      await invokeAdmin("updateDeviceAlias", {
        deviceId: aliasModalDevice.deviceId,
        alias: aliasDraft,
      });
      setAliasModalDeviceId("");
      setAliasDraft("");
      await loadAll(true);
    } catch (aliasError) {
      setError(formatEdgeFunctionError(aliasError));
    } finally {
      setBusyAction("");
    }
  }

  async function openTransferHistory(deviceIdOverride = "") {
    if (profile?.role !== "super_admin") {
      return;
    }

    try {
      setTransferHistoryOpen(true);
      setTransferHistoryLoading(true);
      setError("");
      const scopedDeviceId = String(deviceIdOverride || (selectedDeviceId === "all" ? "" : selectedDeviceId) || "").trim();
      const data = await invokeAdmin("listTransferHistory", {
        deviceId: scopedDeviceId,
      });
      setTransferHistory({
        jobs: data.jobs || [],
        auditLogs: data.auditLogs || [],
      });
    } catch (historyError) {
      setError(formatEdgeFunctionError(historyError));
      setTransferHistory({ jobs: [], auditLogs: [] });
    } finally {
      setTransferHistoryLoading(false);
    }
  }

  async function refreshStorageArtifacts() {
    if (profile?.role !== "super_admin") {
      return;
    }
    try {
      setBusyAction("artifacts:refresh");
      const data = await invokeAdmin("listStorageArtifacts");
      setStorageArtifacts(data.artifacts || []);
      setError("");
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
    } finally {
      setBusyAction("");
    }
  }

  async function deleteStorageArtifact(artifact) {
    const fileName = artifact?.fileName || artifact?.objectKey || "berkas";
    const confirmed = window.confirm(`Hapus berkas "${fileName}" dari bucket ${artifact?.bucket}?`);
    if (!confirmed) {
      return;
    }

    try {
      setBusyAction(`artifact-delete:${artifact.id || artifact.objectKey}`);
      await invokeAdmin("deleteStorageArtifact", {
        bucket: artifact.bucket,
        objectKey: artifact.objectKey,
        jobId: artifact.jobId,
        deviceId: artifact.deviceId,
        fileName,
      });
      await refreshStorageArtifacts();
      await loadAll(true);
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
    } finally {
      setBusyAction("");
    }
  }

  function dismissGuestDeviceLink() {
    setDashboardInfo("Penautan perangkat dilewati. Anda tetap dapat menggunakan halaman ini sesuai akses akun.");
    clearGuestLinkRequest();
  }

  async function handleDeleteAccount(account) {
    if (!account?.user_id) {
      return;
    }

    const confirmed = window.confirm(
      `Hapus akun ${account.display_name || account.email} (${account.role}) secara permanen?`
    );
    if (!confirmed) {
      return;
    }

    await handleAccountAction("deleteAccount", { userId: account.user_id });
  }

  async function createManagedAccount() {
    if (!createEmail || !createPassword) {
      setError("Email dan password account wajib diisi.");
      return;
    }

    await handleAccountAction("createAccount", {
      email: createEmail,
      password: createPassword,
      displayName: createDisplayName,
      role: createRole,
      approveImmediately: createApproveImmediately,
      environmentId: createRole === "user" ? environments[0]?.id || profile?.primary_environment_id || "" : "",
      deviceId: createRole === "user" ? createAssignedDeviceId : "",
    });

    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
  }

  async function openPath(nextPath) {
    setCurrentPath(nextPath);
    const job = await createFileJob("list_directory", { sourcePath: nextPath });
    if (job) {
      setDirectoryJobId(job.id);
      setDirectoryResult(null);
      setSelectedTab("files");
    }
  }

  async function openParentPath() {
    if (!currentPath) {
      return;
    }

    const breadcrumbs = buildBreadcrumbs(currentPath);
    if (breadcrumbs.length <= 1) {
      await openPath(currentPath);
      return;
    }

    await openPath(breadcrumbs[breadcrumbs.length - 2].path);
  }

  async function refreshRoots() {
    await createFileJob("discover_roots");
  }

  async function previewItem(item) {
    const job = await createFileJob("preview_file", { sourcePath: item.path });
    if (job) {
      setPreviewJobId(job.id);
      setPreviewResult(null);
    }
  }

  function toggleSelection(item) {
    setSelectedPaths((current) =>
      current.includes(item.path)
        ? current.filter((value) => value !== item.path)
        : [...current, item.path]
    );
  }

  async function queueDownloadSelection() {
    if (!selectedPaths.length) {
      return;
    }

    if (selectedPaths.length === 1 && directoryResult?.items?.find((item) => item.path === selectedPaths[0] && item.type === "file")) {
      await createFileJob("download_file", {
        sourcePath: selectedPaths[0],
        deliveryMode: "temp",
      });
      return;
    }

    await createFileJob("archive_paths", {
      sourcePath: currentPath,
      selection: selectedPaths,
      deliveryMode: "temp",
    });
  }

  async function handleArtifactDownload(job) {
    async function signArtifact(part, fallbackName) {
      try {
        const data = await invokeAdmin("signArtifact", {
          bucket: part.bucket,
          objectKey: part.objectKey,
          downloadFileName: fallbackName,
        });
        return data.signedUrl;
      } catch (_functionError) {
        const { data, error: signError } = await supabase.storage
          .from(part.bucket)
          .createSignedUrl(part.objectKey, 60 * 15, {
            download: fallbackName,
          });
        if (signError) {
          throw signError;
        }
        return data.signedUrl;
      }
    }

    function triggerBrowserDownload(url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    try {
      setBusyAction(`download:${job.id}`);

      const parts =
        Array.isArray(job.result?.parts) && job.result.parts.length > 0
          ? job.result.parts
          : [
              {
                bucket: job.artifact_bucket,
                objectKey: job.artifact_object_key,
                fileName: job.result?.fileName || job.artifact_object_key.split("/").pop(),
              },
            ];

      for (const part of parts) {
        const downloadFileName = part.fileName || part.objectKey.split("/").pop();
        const signedUrl = await signArtifact(part, downloadFileName);
        triggerBrowserDownload(signedUrl);
        if (parts.length > 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }
    } catch (downloadError) {
      setError(formatEdgeFunctionError(downloadError));
    } finally {
      setBusyAction("");
    }
  }

  async function promoteArchive(job) {
    try {
      setBusyAction(`promote:${job.id}`);
      await invokeAdmin("promoteArchive", { jobId: job.id });
      loadAll(true);
    } catch (promoteError) {
      setError(formatEdgeFunctionError(promoteError));
    } finally {
      setBusyAction("");
    }
  }

  async function cancelJob(job) {
    try {
      setBusyAction(`cancel:${job.id}`);
      try {
        await invokeAdmin("cancelJob", { jobId: job.id });
      } catch (_functionError) {
        const { error: updateError } = await supabase
          .from("file_jobs")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        if (updateError) {
          throw updateError;
        }
      }
      loadAll(true);
    } catch (cancelError) {
      setError(formatEdgeFunctionError(cancelError));
    } finally {
      setBusyAction("");
    }
  }

  async function triggerUpload(file) {
    if (!selectedDevice || !currentPath || !file) {
      return;
    }

    try {
      setBusyAction(`upload:${file.name}`);
      const objectKey = `${selectedDevice.deviceId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("admin-upload-staging")
        .upload(objectKey, file, {
          upsert: true,
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        throw uploadError;
      }

      await createFileJob("upload_place", {
        destinationPath: currentPath,
        options: {
          stagingBucket: "admin-upload-staging",
          stagingObjectKey: objectKey,
          originalFileName: file.name,
        },
      });
    } catch (uploadError) {
      setError(formatEdgeFunctionError(uploadError));
    } finally {
      setBusyAction("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  if (guestDeviceId) {
    return <GuestConsole deviceId={guestDeviceId} />;
  }

  if (resetPasswordMode) {
    return <PasswordResetScreen />;
  }

  if (!session) {
    return (
      <LoginScreen
        mode={authMode}
        email={loginEmail}
        password={loginPassword}
        displayName={registerDisplayName}
        role={registerRole}
        registrationMode={registerMode}
        referralCode={registerReferralCode}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        setDisplayName={setRegisterDisplayName}
        setRole={setRegisterRole}
        setRegistrationMode={setRegisterMode}
        setReferralCode={setRegisterReferralCode}
        setMode={setAuthMode}
        onSubmit={signIn}
        onForgotPassword={sendForgotPassword}
        error={authError}
        info={authInfo}
        loading={authBusy}
      />
    );
  }

  if (profileLoading) {
    return <div className="empty-state">Loading account profile...</div>;
  }

  if (!profile) {
    return <AccountStatusScreen profile={{ status: "pending", email: session.user.email }} onSignOut={signOut} />;
  }

  if (profile.status !== "approved") {
    return <AccountStatusScreen profile={profile} onSignOut={signOut} />;
  }

  const isSuperAdmin = profile.role === "super_admin";
  const isOperator = profile.role === "operator";
  const isUser = profile.role === "user";
  const showGuestLinkPrompt =
    (isUser || isOperator) && Boolean(pendingGuestLinkDeviceId) && profile.status === "approved";
  const linkingGuestDevice = busyAction === `guest-link:${pendingGuestLinkDeviceId}`;
  const activeRunningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccountCount = accounts.filter((account) => account.status === "pending").length;
  const dashboardNavItems = getDashboardNavItems({
    isSuperAdmin,
    isOperator,
    deviceCount: deviceEntries.length,
    pendingAccounts: pendingAccountCount,
    runningJobs: activeRunningJobs,
  });

  function openDeviceRoute(deviceId) {
    navigateRoute("devices", { deviceId });
  }

  return (
    <main className={`console-shell app-shell-page role-${profile.role}`}>
      <div className="app-shell">
        <SidebarNav
          profile={profile}
          activeSection={selectedTab}
          items={dashboardNavItems}
          onNavigate={navigateRoute}
          onTransferHistory={openTransferHistory}
        />
        <section className="app-content">
          <RouteHeader
            route={appRoute}
            profile={profile}
            channelState={channelState}
            loading={loading}
            authBusy={authBusy}
            onRefresh={() => loadAll()}
            onSignOut={signOut}
          />

      {error ? <div className="error-banner">{error}</div> : null}
      {dashboardInfo ? <div className="service-note">{dashboardInfo}</div> : null}
      {showGuestLinkPrompt ? (
        <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-link-title">
          <div className="guest-modal-card">
            <strong id="guest-link-title">Tautkan perangkat ini ke akun Anda?</strong>
            <p>
              Perangkat <span className="mono">{pendingGuestLinkDeviceId}</span> akan ditambahkan ke akses akun ini.
              Setelah tertaut, Anda dapat melihat layanan yang tersedia.
            </p>
            <div className="guest-modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={linkingGuestDevice}
                onClick={dismissGuestDeviceLink}
              >
                Lewati
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={linkingGuestDevice}
                onClick={confirmGuestDeviceLink}
              >
                {linkingGuestDevice ? "Menautkan..." : "Tautkan perangkat"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <DeviceAliasModal
        device={aliasModalDevice}
        value={aliasDraft}
        onChange={setAliasDraft}
        onClose={() => {
          setAliasModalDeviceId("");
          setAliasDraft("");
        }}
        onSave={saveDeviceAlias}
        busy={busyAction === `alias:${aliasModalDevice?.deviceId}`}
      />
      <TransferHistoryModal
        open={transferHistoryOpen}
        loading={transferHistoryLoading}
        history={transferHistory}
        device={selectedDevice}
        deviceId={selectedDeviceId === "all" ? "" : selectedDeviceId}
        onClose={() => setTransferHistoryOpen(false)}
        onDownload={handleArtifactDownload}
      />
      <UpdateProgressModal
        open={updateModal.open}
        update={updateModalModel}
        title={updateModal.title}
        message={updateModal.message}
        onClose={() =>
          setUpdateModal({
            open: false,
            deviceId: "",
            title: "Mengupdate Agent & Service",
            message: "",
            error: "",
          })
        }
      />

      <div className="console-grid dashboard-workspace-grid">
        <aside className="sidebar fleet-sidebar">
          <div className="sidebar-header">
            <h2>Perangkat</h2>
            <button type="button" className="utility-button" onClick={() => navigateRoute("devices", { selectAll: true })}>
              Semua
            </button>
          </div>
          <DeviceList
            devices={deviceEntries}
            selectedDeviceId={selectedDeviceId}
            onSelect={openDeviceRoute}
            now={now}
          />
        </aside>

        <section className="workspace">
          {["overview", "devices"].includes(selectedTab) ? (
            <>
              <DashboardStats devices={deviceEntries} fileJobs={fileJobs} accounts={accounts} now={now} />
              {selectedTab === "devices" ? (
                deviceEntries.length ? (
                  <DeviceGrid
                    devices={deviceEntries}
                    selectedDeviceId={selectedDevice?.deviceId || selectedDeviceId}
                    onOpen={openDeviceRoute}
                    now={now}
                  />
                ) : (
                  <div className="empty-state">Belum ada perangkat aktif untuk akun ini.</div>
                )
              ) : null}
            </>
          ) : null}
          {selectedTab === "profile" ? (
            <ProfilePanel profile={profile} session={session} onSignOut={signOut} />
          ) : selectedDevice ||
            selectedTab === "activity" ||
            selectedTab === "devices" ||
            (selectedTab === "files" && isSuperAdmin) ||
            (selectedTab === "accounts" && (isSuperAdmin || isOperator)) ? (
            <>
              {["overview", "devices"].includes(selectedTab) && selectedDevice ? (
                <section className="panel-stack">
                  <article className="device-panel">
                    <div className="device-panel-top">
                      <div>
                        <h2>{selectedDevice.deviceName}</h2>
                        <div className="mono">{selectedDevice.deviceId}</div>
                        {selectedDevice.deviceAlias ? (
                          <div className="root-card-note">Nama asli: {selectedDevice.rawDeviceName}</div>
                        ) : null}
                      </div>
                      <div className="service-status-group">
                        <StatusChip
                          status={selectedDeviceBadge.status}
                          label={selectedDeviceBadge.label}
                        />
                        <ActionButton className="secondary-button" onClick={() => openAliasModal(selectedDevice)}>
                          Edit alias
                        </ActionButton>
                      </div>
                    </div>
                    <div className="metric-grid">
                      <div className="metric-card">
                        <span>Terakhir tersambung <InfoHint text="Waktu terakhir perangkat mengirim status terbaru." /></span>
                        <strong>{formatRelativeTime(selectedDevice.deviceRecord?.last_seen, now)}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Layanan aktif <InfoHint text="Jumlah layanan yang sedang berjalan." /></span>
                        <strong>{selectedDevice.runningCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Proses berkas <InfoHint text="Jumlah aktivitas berkas yang masih berlangsung." /></span>
                        <strong>{selectedDevice.fileJobCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Perlu perhatian <InfoHint text="Jumlah layanan yang perlu dicek." /></span>
                        <strong>{selectedDevice.issueCount}</strong>
                      </div>
                      <DeviceUpdateCard
                        deviceRecord={selectedDevice.deviceRecord}
                        deviceStatus={selectedDevice.deviceStatus}
                        busy={busyAction === `${selectedDevice.deviceId}:device:update`}
                        onUpdate={() => queueCommand(selectedDevice.deviceId, null, "update")}
                        showAction
                      />
                    </div>
                  </article>

                  <article className="service-panel">
                    <div className="panel-heading-row">
                      <h3>Layanan <InfoHint text="Mulai atau hentikan layanan pada perangkat yang dipilih." /></h3>
                      <div className="panel-actions device-control-actions">
                        {isSuperAdmin || isOperator ? (
                          <ActionButton
                            className="secondary-button"
                            busy={busyAction === `${selectedDevice.deviceId}:device:kill`}
                            disabled={busyAction !== "" && busyAction !== `${selectedDevice.deviceId}:device:kill`}
                            onClick={() => queueCommand(selectedDevice.deviceId, null, "kill")}
                          >
                            Hentikan koneksi
                          </ActionButton>
                        ) : null}
                        {isSuperAdmin ? (
                          <>
                            <ActionButton
                              className={selectedDevice.deviceStatus === "blocked" ? "primary-button" : "danger-button"}
                              busy={busyAction === `${selectedDevice.deviceId}:${selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"}`}
                              disabled={busyAction !== "" && busyAction !== `${selectedDevice.deviceId}:${selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"}`}
                              onClick={() =>
                                updateDeviceStatus(
                                  selectedDevice.deviceId,
                                  selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"
                                )
                              }
                            >
                              {selectedDevice.deviceStatus === "blocked" ? "Aktifkan perangkat" : "Batasi perangkat"}
                            </ActionButton>
                            <ActionButton
                              className="secondary-button"
                              busy={transferHistoryLoading}
                              onClick={() => openTransferHistory(selectedDevice.deviceId)}
                            >
                              Riwayat transfer
                            </ActionButton>
                          </>
                        ) : null}
                        <ActionButton
                          className="secondary-button"
                          busy={busyAction === `guest:${selectedDevice.deviceId}`}
                          disabled={busyAction !== "" && busyAction !== `guest:${selectedDevice.deviceId}`}
                          onClick={() => copyGuestLink(selectedDevice.deviceId)}
                        >
                          Salin tautan
                        </ActionButton>
                      </div>
                    </div>

                    {isSuperAdmin || isOperator || isUser ? (
                      <div className="metric-card guest-monitor-card">
                        <span>Tautan akses <InfoHint text="Tautan ini membuka halaman status perangkat dan E-Rapor." /></span>
                        <strong className="service-link mono">
                          <a href={selectedGuestUrl} target="_blank" rel="noreferrer">
                            {selectedGuestUrl}
                          </a>
                        </strong>
                        <PublicLinkActions
                          url={selectedGuestUrl}
                          label={`Tautan akses untuk ${selectedDevice.deviceName}`}
                          compact
                          onActionComplete={setError}
                        />
                      </div>
                    ) : null}

                    <div className="service-stack">
                      {visibleServices.map((service) => {
                        const runtimeBadge = getServiceStatusBadgeModel(service.serviceStatus);
                        const publicBadge = getPublicLinkBadgeModel(service);
                        const runningNow =
                          service.serviceStatus === "running" &&
                          service.desired_state !== "stopped";
                        return (
                        <article key={service.id} className={`service-card tone-${statusTone(service.serviceStatus)}`}>
                          <div className="service-card-header">
                            <div>
                              <strong>{service.service_name}</strong>
                              <div className="mono">localhost:{service.port}</div>
                            </div>
                            <div className="service-status-group">
                              <StatusChip
                                status={runtimeBadge.status}
                                label={runtimeBadge.label}
                              />
                              <StatusChip
                                status={publicBadge.status}
                                label={publicBadge.label}
                              />
                              <StatusChip status={service.location_status || "unknown"} label={service.location_status === "ready" ? "lokasi siap" : "lokasi perlu dicek"} />
                            </div>
                          </div>
                          <div className="service-detail-grid">
                            <div>
                              <span>{getPublicUrlLabel(service)} <InfoHint text="Tautan untuk membuka layanan E-Rapor dari browser." /></span>
                              <strong className="service-link">
                                {service.public_url ? (
                                  <a href={service.public_url} target="_blank" rel="noreferrer">
                                    {service.public_url}
                                  </a>
                                ) : (
                                  "Belum tersedia"
                                )}
                              </strong>
                            </div>
                            <div>
                              <span>Lokasi aplikasi <InfoHint text="Lokasi aplikasi yang ditemukan pada perangkat." /></span>
                              <strong className="mono">{service.resolved_path || "-"}</strong>
                            </div>
                            <div>
                              <span>Terakhir diperbarui <InfoHint text="Waktu terakhir status layanan diperbarui." /></span>
                              <strong>{formatRelativeTime(service.last_ping, now)}</strong>
                            </div>
                          </div>
                          {service.location_details?.message ? (
                            <div className="service-note">{service.location_details.message}</div>
                          ) : null}
                          {service.last_error ? <div className="job-error">{service.last_error}</div> : null}
                          <PublicLinkActions
                            url={service.public_url || ""}
                            label={`Tautan ${service.service_name} untuk ${selectedDevice.deviceName}`}
                            compact
                            onActionComplete={setError}
                          />
                          <div className="panel-actions service-command-actions">
                            <ActionButton
                              className="primary-button"
                              busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:start`}
                              disabled={busyAction !== "" || runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "start")}
                            >
                              Mulai
                            </ActionButton>
                            <ActionButton
                              className="secondary-button"
                              busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:stop`}
                              disabled={busyAction !== "" || !runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "stop")}
                            >
                              Hentikan
                            </ActionButton>
                          </div>
                        </article>
                      )})}
                    </div>
                  </article>
                </section>
              ) : null}

              {selectedTab === "devices" && !selectedDevice ? (
                <div className="empty-state">Perangkat belum tersedia atau berada di luar akses akun ini.</div>
              ) : null}

              {selectedTab === "files" && isSuperAdmin ? (
                <section className="files-shell">
                  <article className="files-toolbar">
                    <div>
                      <h3>Berkas Perangkat</h3>
                      <div className="mono">{currentPath || "Pilih lokasi berkas"}</div>
                    </div>
                    <div className="panel-actions">
                      <button type="button" className="secondary-button" onClick={refreshRoots}>
                        Segarkan lokasi
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!currentPath}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Unggah ke sini
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={selectedPaths.length === 0}
                        onClick={queueDownloadSelection}
                      >
                        Unduh pilihan
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      onChange={(event) => triggerUpload(event.target.files?.[0])}
                    />
                  </article>

                  <RootGrid roots={selectedDeviceRoots} onOpen={openPath} />

                  <div className="files-grid">
                    <article className="files-panel">
                      <div className="panel-heading-row">
                        <h3>Daftar Berkas</h3>
                        {directoryJobId ? <StatusChip status="running_job" label="memuat" /> : null}
                      </div>
                      <FileTable
                        currentPath={currentPath}
                        items={directoryResult?.items || []}
                        warnings={directoryResult?.warnings || []}
                        focusedPath={directoryResult?.focusedPath || null}
                        selectedPaths={selectedPaths}
                        onToggle={toggleSelection}
                        onOpen={openPath}
                        onPreview={previewItem}
                        onOpenParent={openParentPath}
                      />
                    </article>

                    <article className="preview-panel">
                      <div className="panel-heading-row">
                        <h3>Pratinjau</h3>
                        {previewJobId ? <StatusChip status="running_job" label="menyiapkan" /> : null}
                      </div>
                      {!previewResult ? (
                        <div className="empty-state">Pilih file untuk melihat pratinjau atau detailnya.</div>
                      ) : previewResult.previewType === "text" ? (
                        <pre className="preview-text">{previewResult.content}</pre>
                      ) : (
                        <div className="preview-artifact">
                          <div className="mono">{previewResult.path}</div>
                          <div>{previewResult.mimeType}</div>
                          <div>{formatBytes(previewResult.size)}</div>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              handleArtifactDownload({
                                artifact_bucket: previewResult.bucket,
                                artifact_object_key: previewResult.objectKey,
                                result: { fileName: previewResult.path.split(/[/\\]/).pop() },
                              })
                            }
                          >
                            Buka pratinjau
                          </button>
                        </div>
                      )}
                    </article>
                  </div>

                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>Aktivitas Berkas</h3>
                      <StatusChip status={selectedDeviceJobs.filter((job) => ["pending", "running"].includes(job.status)).length ? "running_job" : "ready"} label={`${selectedDeviceJobs.length} aktivitas`} />
                    </div>
                    <JobList
                      jobs={selectedDeviceJobs}
                      onDownload={handleArtifactDownload}
                      onPromote={promoteArchive}
                      onCancel={cancelJob}
                    />
                  </article>

                  <ArtifactInventory
                    artifacts={visibleStorageArtifacts}
                    deviceOptions={artifactDeviceOptions}
                    bucketFilter={artifactBucketFilter}
                    deviceFilter={artifactDeviceFilter}
                    search={artifactSearch}
                    busyAction={busyAction}
                    onBucketFilter={setArtifactBucketFilter}
                    onDeviceFilter={setArtifactDeviceFilter}
                    onSearch={setArtifactSearch}
                    onRefresh={refreshStorageArtifacts}
                    onDownload={handleArtifactDownload}
                    onDelete={deleteStorageArtifact}
                  />
                </section>
              ) : null}

              {selectedTab === "activity" ? (
                <section className="activity-shell">
                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>Aktivitas Terbaru</h3>
                      <StatusChip status={channelState} />
                      <select value={logLevelFilter} onChange={(event) => setLogLevelFilter(event.target.value)}>
                        <option value="all">Semua</option>
                        <option value="error">Perlu dicek</option>
                        <option value="warn">Peringatan</option>
                        <option value="info">Informasi</option>
                      </select>
                    </div>
                    <div className="log-stack">
                      {logs
                        .filter((log) => logLevelFilter === "all" || log.level === logLevelFilter)
                        .filter((log) => selectedDeviceId === "all" || log.device_id === selectedDeviceId)
                        .filter((log) => !isUser || !log.service_name || log.service_name === "rapor")
                        .map((log) => (
                          <article key={log.id} className={`log-card tone-${statusTone(log.level)}`}>
                            <div className="log-card-top">
                              <strong>{log.message}</strong>
                              <StatusChip status={log.level} />
                            </div>
                            <div className="log-card-meta mono">
                              {formatDate(log.created_at)} · {log.device_id} · {log.service_name || "system"}
                            </div>
                            {log.details ? (
                              <pre className="log-details">{JSON.stringify(log.details, null, 2)}</pre>
                            ) : null}
                          </article>
                        ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {selectedTab === "accounts" && (isSuperAdmin || isOperator) ? (
                <section className="panel-stack">
                  {isSuperAdmin ? (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>Aturan Persetujuan</h3>
                        <StatusChip
                          status={authPolicy.standaloneUserApprovalMode === "auto" ? "running" : "warn"}
                          label={
                            authPolicy.standaloneUserApprovalMode === "auto"
                              ? "otomatis"
                              : "manual"
                          }
                        />
                      </div>
                      <div className="service-detail-grid">
                        <label>
                          <span>Persetujuan Operator</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.operatorAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                operatorAutoApproveHours: Number(event.target.value || 24),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Pengguna lingkungan</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.environmentUserAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                environmentUserAutoApproveHours: Number(event.target.value || 8),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Pengguna mandiri</span>
                          <select
                            value={authPolicy.standaloneUserApprovalMode}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                standaloneUserApprovalMode: event.target.value,
                              }))
                            }
                          >
                            <option value="manual">Manual</option>
                            <option value="auto">Otomatis</option>
                          </select>
                        </label>
                        <label>
                          <span>Waktu persetujuan mandiri</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.standaloneUserAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                standaloneUserAutoApproveHours: Number(event.target.value || 24),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Interval pemeriksaan</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.maintenanceIntervalMinutes}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                maintenanceIntervalMinutes: Number(event.target.value || 15),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Halaman reset password</span>
                          <input
                            value={authPolicy.passwordResetRedirectUrl}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                passwordResetRedirectUrl: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="panel-actions" style={{ alignItems: "end" }}>
                          <ActionButton
                            className="primary-button"
                            busy={busyAction === "account:updateAuthPolicy"}
                            onClick={() => handleAccountAction("updateAuthPolicy", authPolicy)}
                          >
                            Simpan aturan
                          </ActionButton>
                        </div>
                      </div>
                    </article>
                  ) : null}
                  {environments.length ? (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>Lingkungan Operator</h3>
                        <StatusChip status="ready" label={`${environments.length} lingkungan`} />
                      </div>
                      <div className="job-stack">
                        {environments.map((environment) => (
                          <article key={environment.id} className="job-card">
                            <div className="job-card-top">
                              <div>
                                <strong>{environment.name}</strong>
                                <div className="mono">{environment.referral_code}</div>
                              </div>
                              <div className="service-status-group">
                                <StatusChip status={environment.is_active ? "ready" : "disabled"} label={environment.is_active ? "aktif" : "nonaktif"} />
                              </div>
                            </div>
                            <div className="job-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => copyTextToClipboard(environment.referral_code).then(() => setError("")).catch((copyError) => setError(formatEdgeFunctionError(copyError)))}
                              >
                                Salin kode lingkungan
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleAccountAction("rotateReferralCode", { environmentId: environment.id })}
                              >
                                Ganti kode
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </article>
                  ) : (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>Lingkungan Operator</h3>
                        <StatusChip status="warn" label="belum tersedia" />
                      </div>
                      <div className="empty-state">
                        Kode lingkungan belum tersedia. Segarkan halaman untuk memuat ulang data.
                      </div>
                    </article>
                  )}
                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>Akun</h3>
                      <StatusChip status="ready" label={`${accounts.length} akun`} />
                    </div>
                    <div className="service-detail-grid" style={{ marginBottom: 16 }}>
                      <label>
                        <span>Email</span>
                        <input value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} placeholder="nama@email.com" />
                      </label>
                      <label>
                        <span>Nama</span>
                        <input value={createDisplayName} onChange={(event) => setCreateDisplayName(event.target.value)} placeholder="Nama pengguna" />
                      </label>
                      <PasswordField
                        label="Password"
                        value={createPassword}
                        onChange={(event) => setCreatePassword(event.target.value)}
                        placeholder="Password sementara"
                        autoComplete="new-password"
                      />
                      <label>
                        <span>Jenis akun</span>
                        {isSuperAdmin ? (
                          <select value={createRole} onChange={(event) => setCreateRole(event.target.value)}>
                            <option value="operator">Operator</option>
                            <option value="user">User</option>
                          </select>
                        ) : (
                          <input value="User" disabled readOnly />
                        )}
                      </label>
                      <label>
                        <span>Status awal</span>
                        <select value={createApproveImmediately ? "approved" : "pending"} onChange={(event) => setCreateApproveImmediately(event.target.value === "approved")}>
                          <option value="approved">Aktif sekarang</option>
                          <option value="pending">Menunggu persetujuan</option>
                        </select>
                      </label>
                      {createRole === "user" ? (
                        <label>
                          <span>Perangkat awal</span>
                          <select
                            value={createAssignedDeviceId}
                            onChange={(event) => setCreateAssignedDeviceId(event.target.value)}
                            disabled={!deviceEntries.length}
                          >
                            <option value="">
                              {deviceEntries.length ? "Pilih perangkat" : "Belum ada perangkat tersedia"}
                            </option>
                            {deviceEntries.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.deviceName} ({device.deviceId})
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="panel-actions" style={{ alignItems: "end" }}>
                        <ActionButton
                          className="primary-button"
                          busy={busyAction === "account:createAccount"}
                          onClick={createManagedAccount}
                        >
                          Buat akun
                        </ActionButton>
                      </div>
                    </div>
                    <div className="job-stack">
                      {accounts.map((account) => (
                        <article key={account.user_id} className={`job-card tone-${statusTone(account.status)}`}>
                          <div className="job-card-top">
                            <div>
                              <strong>{account.display_name || account.email}</strong>
                              <div className="mono">{account.email}</div>
                            </div>
                            <div className="service-status-group">
                              <StatusChip status={account.role} />
                              <StatusChip status={account.status} />
                              {account.membership?.status ? <StatusChip status={account.membership.status} label={`lingkungan ${getStatusLabel(account.membership.status)}`} /> : null}
                            </div>
                          </div>
                          <div className="job-card-meta">
                            <span>dibuat {formatDate(account.created_at)}</span>
                            {account.approval_due_at ? (
                              <span>persetujuan {formatRelativeTime(account.approval_due_at)}</span>
                            ) : null}
                            {account.membership?.joined_via ? <span>melalui {String(account.membership.joined_via).replace(/_/g, " ")}</span> : null}
                          </div>
                          {account.rejection_reason ? <div className="job-error">{account.rejection_reason}</div> : null}
                          <div className="job-actions">
                            {account.status !== "approved" ? (
                              <ActionButton className="primary-button" busy={busyAction === "account:approveAccount"} onClick={() => handleAccountAction("approveAccount", { userId: account.user_id })}>
                                Setujui
                              </ActionButton>
                            ) : null}
                            {account.status === "pending" ? (
                              <>
                                <ActionButton className="secondary-button" busy={busyAction === "account:extendApproval"} onClick={() => handleAccountAction("extendApproval", { userId: account.user_id, hours: account.role === "operator" ? authPolicy.operatorAutoApproveHours : authPolicy.environmentUserAutoApproveHours })}>
                                  Perpanjang
                                </ActionButton>
                                <ActionButton className="danger-button" busy={busyAction === "account:rejectAccount"} onClick={() => handleAccountAction("rejectAccount", { userId: account.user_id, reason: "Permintaan akun belum dapat disetujui." })}>
                                  Tolak
                                </ActionButton>
                              </>
                            ) : null}
                            {account.status !== "disabled" ? (
                              <ActionButton className="secondary-button" busy={busyAction === "account:disableAccount"} onClick={() => handleAccountAction("disableAccount", { userId: account.user_id })}>
                                Nonaktifkan
                              </ActionButton>
                            ) : null}
                            <ActionButton className="secondary-button" busy={busyAction === "account:resetPassword"} onClick={() => handleAccountAction("resetPassword", { email: account.email })}>
                              Reset password
                            </ActionButton>
                            {isSuperAdmin && ["operator", "user"].includes(account.role) ? (
                              <ActionButton
                                className="danger-button"
                                busy={busyAction === "account:deleteAccount"}
                                onClick={() => handleDeleteAccount(account)}
                              >
                                Hapus akun
                              </ActionButton>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty-state">Belum ada perangkat aktif.</div>
          )}
        </section>
      </div>
        </section>
      </div>
      <MobileNav activeSection={selectedTab} items={dashboardNavItems} onNavigate={navigateRoute} />
    </main>
  );
}
