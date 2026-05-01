import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  CircleArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Info,
  LayoutDashboard,
  Loader2,
  LogOut,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Rocket,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { legacyDataClient } from "../services/legacyDataClient.js";
import Avatar3D from "../components/Avatar3D.jsx";
import githubIcon from "../assets/icons/github.png";
import paypalIcon from "../assets/icons/paypal.png";
import trakteerIcon from "../assets/icons/trakteer.png";

const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 90000);
const HEARTBEAT_UNSTABLE_MS = Number(import.meta.env.VITE_HEARTBEAT_UNSTABLE_MS || 180000);
const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
const LOG_LIMIT = 120;
const JOB_LIMIT = 80;
const PUBLIC_DASHBOARD_URL = String(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    "https://school-services.netlify.app"
).replace(/\/+$/, "");
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(
  /\/+$/,
  ""
);
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "");
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

function buildThisPcDirectoryResult(roots) {
  const source = Array.isArray(roots) ? roots : [];
  const driveRoots = source.filter((root) => String(root.root_type || "") === "drive");
  const items = (driveRoots.length ? driveRoots : source).map((root) => ({
    name: String(root.label || root.path || "Drive"),
    path: String(root.path || ""),
    type: "directory",
    size: null,
    modifiedAt: null,
    hidden: false,
    virtualKind: String(root.root_type || "drive"),
    description: String(root.metadata?.description || "").trim(),
    locationStatus: String(root.metadata?.locationStatus || root.root_type || "drive"),
  }));

  return {
    path: "",
    parentPath: "",
    items,
    warnings: [],
    virtualRootLabel: "This PC",
  };
}

function dismissOnBackdrop(event, onClose) {
  if (event.target === event.currentTarget) {
    onClose?.();
  }
}

function formatArtifactDetailValue(artifact) {
  const parts = Array.isArray(artifact?.result?.parts) ? artifact.result.parts : [];
  const lines = [
    `Nama: ${artifact?.fileName || safeFileNameFromKey(artifact?.objectKey || "") || "-"}`,
    `Bucket: ${artifact?.bucket || "-"}`,
    `Path: ${artifact?.sourcePath || artifact?.objectKey || "-"}`,
    `Device: ${artifact?.deviceName || artifact?.deviceId || "-"}`,
    `Status: ${artifact?.status || "-"}`,
    `Waktu: ${formatDate(artifact?.createdAt || artifact?.completedAt)}`,
    `Ukuran: ${formatBytes(Number(artifact?.size || 0))}`,
  ];

  if (parts.length) {
    lines.push("", "Bagian ZIP:");
    parts.forEach((part, index) => {
      lines.push(`${index + 1}. ${part.fileName || safeFileNameFromKey(part.objectKey || "") || "-"}`);
      lines.push(`   Bucket: ${part.bucket || artifact?.bucket || "-"}`);
      lines.push(`   Key: ${part.objectKey || "-"}`);
    });
  }

  return lines.join("\n");
}

function getRouteBreadcrumbs(route, profile, options = {}) {
  const items = [
    { label: profile?.role === "super_admin" ? "SuperAdmin" : profile?.role === "operator" ? "Operator" : "User" },
  ];
  const copy = getRouteCopy(route.section, profile?.role || "user");
  items.push({ label: copy.title });

  if (route.section === "files" && options.filesView) {
    items.push({ label: options.filesView === "remote" ? "Remote File" : "Storage" });
  }
  if (route.section === "devices" && options.deviceName) {
    items.push({ label: options.deviceName });
  }
  if (route.section === "activity" && options.deviceName) {
    items.push({ label: options.deviceName });
  }

  return items;
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

function truncateText(value, maxLength = 42) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(12, maxLength - 12))}...${text.slice(-8)}`;
}

function getStatusIcon(status) {
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

function StatusPill({ status, label, className = "", iconOnly = false, title = "" }) {
  const Icon = getStatusIcon(status);
  return (
    <span
      className={`status-chip tone-${statusTone(status)} ${className}`.trim()}
      title={title || undefined}
      aria-label={title || label || getStatusLabel(status)}
    >
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      {iconOnly ? null : label || getStatusLabel(status)}
    </span>
  );
}

function StatusChip(props) {
  return <StatusPill {...props} />;
}

function IconButton({ label, icon: Icon = MoreHorizontal, className = "", ...props }) {
  return (
    <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

function InfoHint({ text }) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text}>
      <Info size={14} strokeWidth={2.4} aria-hidden="true" />
      <span className="info-hint-bubble">{text}</span>
    </span>
  );
}

function ToastViewport({ items = [], onDismiss }) {
  if (!items.length) {
    return null;
  }

  return createPortal(
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <article key={item.id} className={`toast-card tone-${item.tone || "info"}`}>
          <strong>{item.title}</strong>
          {item.message ? <p>{item.message}</p> : null}
          <button type="button" className="toast-dismiss" onClick={() => onDismiss(item.id)} aria-label="Tutup notifikasi">
            <X size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </article>
      ))}
    </div>,
    document.body
  );
}

function CommandProgressOverlay({
  open = false,
  title = "Menjalankan perintah",
  message = "Sedang memproses perubahan layanan.",
  percent = 24,
}) {
  if (!open) {
    return null;
  }

  return createPortal(
    <div className="command-progress-overlay" role="status" aria-live="polite" aria-atomic="true">
      <div className="command-progress-card">
        <div className="command-progress-orb" aria-hidden="true">
          <Loader2 size={18} className="button-spinner-icon" />
        </div>
        <strong>{title}</strong>
        <p>{message}</p>
        <div className="command-progress-track" aria-label={`Progress perintah ${percent}%`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

function ActionButton({
  children,
  busy = false,
  className = "secondary-button",
  disabled = false,
  icon: Icon = null,
  ...props
}) {
  return (
    <button type="button" className={`${className} action-button`} disabled={disabled || busy} {...props}>
      {busy ? <Loader2 className="button-spinner-icon" size={16} aria-hidden="true" /> : null}
      {!busy && Icon ? <Icon size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function Skeleton({ className = "", lines = 1 }) {
  if (lines > 1) {
    return (
      <div className={`skeleton-stack ${className}`.trim()} aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <span key={index} className={`skeleton-line skeleton-line-${index + 1}`} />
        ))}
      </div>
    );
  }
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

function PageSkeleton({ title = "Memuat data" }) {
  return (
    <main className="console-shell app-shell-page skeleton-page" aria-busy="true" aria-label={title}>
      <div className="app-shell">
        <aside className="app-sidebar">
          <Skeleton className="skeleton-brand" />
          <Skeleton lines={5} />
        </aside>
        <section className="app-content">
          <section className="top-command-bar">
            <Skeleton className="skeleton-pill" />
            <Skeleton className="skeleton-pill" />
            <Skeleton className="skeleton-avatar" />
          </section>
          <section className="app-route-header">
            <Skeleton lines={3} />
          </section>
          <section className="priority-banner">
            <Skeleton lines={2} />
            <Skeleton className="skeleton-button" />
          </section>
          <section className="dashboard-stats-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <article className="dashboard-stat-card metric-tile" key={index}>
                <Skeleton lines={3} />
              </article>
            ))}
          </section>
        </section>
      </div>
    </main>
  );
}

function GuestStatusSkeleton() {
  return (
    <section className="guest-skeleton-grid" aria-busy="true" aria-label="Memuat status perangkat">
      {Array.from({ length: 5 }).map((_, index) => (
        <article key={index} className="metric-card guest-status-card">
          <Skeleton lines={3} />
        </article>
      ))}
    </section>
  );
}

function normalizeEmailInput(value) {
  return String(value || "").trim().toLowerCase();
}

function maskReferralCode(value) {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function normalizeUrlInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function MaskedTextField({
  label,
  value,
  onChange,
  mask = "text",
  placeholder = "",
  autoComplete,
  disabled = false,
  type = "text",
  inputMode,
  maxLength,
}) {
  const inputId = useId();

  function applyMask(nextValue, eventType = "change") {
    if (mask === "email") {
      return eventType === "blur" ? normalizeEmailInput(nextValue) : String(nextValue || "");
    }
    if (mask === "referral") {
      return maskReferralCode(nextValue);
    }
    if (mask === "url") {
      return eventType === "blur" ? normalizeUrlInput(nextValue) : String(nextValue || "");
    }
    if (mask === "number") {
      return String(nextValue || "").replace(/[^\d]/g, "");
    }
    if (mask === "alias") {
      return String(nextValue || "").replace(/\s+/g, " ").slice(0, maxLength || 80);
    }
    return String(nextValue || "");
  }

  return (
    <div className="masked-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(event) => onChange(applyMask(event.target.value))}
        onBlur={(event) => onChange(applyMask(event.target.value, "blur"))}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
      />
    </div>
  );
}

function DetailDrawer({ title = "Detail", value, onClose }) {
  if (!value) {
    return null;
  }

  const drawer = (
    <div
      className="detail-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-drawer-title"
      onMouseDown={(event) => dismissOnBackdrop(event, onClose)}
    >
      <section className="detail-drawer">
        <div className="detail-drawer-header">
          <div>
            <span className="section-eyebrow">Detail</span>
            <strong id="detail-drawer-title">{title}</strong>
          </div>
          <IconButton label="Tutup detail" icon={X} onClick={onClose} />
        </div>
        <pre className="detail-drawer-content">{String(value)}</pre>
        <div className="panel-actions">
          <ActionButton className="secondary-button" onClick={() => copyTextToClipboard(value).catch(() => {})}>
            <Copy size={16} aria-hidden="true" />
            Salin
          </ActionButton>
          <ActionButton className="primary-button" onClick={onClose}>
            Tutup
          </ActionButton>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return drawer;
  }

  return createPortal(drawer, document.body);
}

function ConfirmDialog({
  open,
  title = "Konfirmasi",
  message = "",
  confirmLabel = "Lanjutkan",
  cancelLabel = "Batal",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}) {
  if (!open) {
    return null;
  }

  const dialog = (
    <div
      className="guest-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onMouseDown={(event) => dismissOnBackdrop(event, onClose)}
    >
      <div className="guest-modal-card dashboard-modal-card confirm-dialog-card">
        <strong id="confirm-dialog-title">{title}</strong>
        <p>{message}</p>
        <div className="guest-modal-actions">
          <ActionButton className="secondary-button" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </ActionButton>
          <ActionButton className={destructive ? "danger-button" : "primary-button"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return dialog;
  }
  return createPortal(dialog, document.body);
}

function LongText({
  value,
  label = "Detail",
  href = "",
  maxLength = 48,
  className = "",
  empty = "-",
  onCopySuccess = null,
  onCopyError = null,
}) {
  const [open, setOpen] = useState(false);
  const text = String(value || "");
  if (!text) {
    return <span className={`long-text long-text-empty ${className}`.trim()}>{empty}</span>;
  }

  const display = truncateText(text, maxLength);

  return (
    <span className={`long-text ${className}`.trim()}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={text}>
          {display}
        </a>
      ) : (
        <span title={text}>{display}</span>
      )}
      <span className="long-text-actions">
        <IconButton
          label={`Salin ${label}`}
          icon={Copy}
          onClick={() =>
            copyTextToClipboard(text)
              .then(() => {
                if (typeof onCopySuccess === "function") {
                  onCopySuccess(text, label);
                }
              })
              .catch((error) => {
                if (typeof onCopyError === "function") {
                  onCopyError(error, label);
                }
              })
          }
        />
        <IconButton label={`Lihat ${label}`} icon={Eye} onClick={() => setOpen(true)} />
      </span>
      {open ? <DetailDrawer title={label} value={text} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function Surface({ children, className = "", as: Component = "section", ...props }) {
  return (
    <Component className={`surface ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}

function SectionHeader({ eyebrow, title, description, actions = null }) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <span className="section-eyebrow">{eyebrow}</span> : null}
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="toolbar">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ title = "Belum ada data", description = "" }) {
  return (
    <div className="empty-state clean-empty-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function MetricTile({ label, value, helper, icon: Icon = Gauge }) {
  return (
    <article className="dashboard-stat-card metric-tile">
      <span className="metric-tile-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function NavIcon({ section }) {
  const icons = {
    overview: LayoutDashboard,
    devices: Monitor,
    files: FolderOpen,
    activity: Activity,
    accounts: Users,
    profile: User,
  };
  const Icon = icons[section] || icons.overview;
  return <Icon className="nav-icon" size={21} strokeWidth={2.2} aria-hidden="true" />;
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

function NotificationPopover({ open, items, onClose }) {
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        onClose?.();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div ref={popoverRef} className="notification-popover" role="dialog" aria-label="Notifikasi dashboard">
      <div className="notification-popover-head">
        <div>
          <span className="section-eyebrow">Notifikasi</span>
          <strong>Ringkasan sistem</strong>
        </div>
        <IconButton label="Tutup notifikasi" icon={X} onClick={onClose} />
      </div>
      <div className="notification-popover-list">
        {items.length ? (
          items.map((item) => {
            const Icon = item.icon || Info;
            return (
              <article key={item.id} className={`notification-item tone-${item.tone || "neutral"}`}>
                <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title="Tidak ada notifikasi" description="Semua status utama sedang normal." />
        )}
      </div>
    </div>
  );
}

function SidebarNav({
  profile,
  activeSection,
  items,
  onNavigate,
  pinned = false,
  onTogglePinned,
  onExpandedChange,
}) {
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <aside
      className={`app-sidebar collapsible-sidebar ${pinned ? "is-pinned" : ""} ${expanded ? "is-expanded" : ""}`}
      aria-label="Navigasi dashboard"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHovered(false);
        }
      }}
    >
      <div className="app-sidebar-brand">
        <img src={GUEST_BRAND_ICON} alt="" aria-hidden="true" />
        <div className="app-sidebar-copy">
          <strong>School Services</strong>
          <span>{profile.email || getStatusLabel(profile.role)}</span>
        </div>
        <IconButton
          label={pinned ? "Collapse sidebar" : "Pin sidebar"}
          icon={pinned ? PanelLeftClose : PanelLeftOpen}
          className="sidebar-pin-button"
          onClick={onTogglePinned}
        />
      </div>
      <nav className="app-nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app-nav-item ${activeSection === item.id ? "app-nav-item-active" : ""}`}
            aria-current={activeSection === item.id ? "page" : undefined}
            onClick={() => {
              onNavigate(item.id);
              if (!pinned) {
                setHovered(false);
              }
            }}
          >
            <span className="app-nav-icon-shell">
              <NavIcon section={item.id} />
              {Number(item.badge || 0) > 0 ? <span className="app-nav-icon-badge">{item.badge}</span> : null}
            </span>
            <span className="app-nav-copy">
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </span>
            {Number(item.badge || 0) > 0 ? <span className="app-nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function ProfileInfoField({ label, value, mono = false }) {
  const text = String(value || "").trim();
  return (
    <div className={`profile-info-card ${mono ? "mono" : ""}`.trim()}>
      <span>{label}</span>
      <strong title={text || "-"}>{text || "-"}</strong>
      {text ? (
        <IconButton
          label={`Salin ${label}`}
          icon={Copy}
          className="profile-copy-button"
          onClick={() => copyTextToClipboard(text).catch(() => {})}
        />
      ) : null}
    </div>
  );
}

function DeviceUpdateStatusIndicator({ update, toneStatus }) {
  let Icon = Info;
  let tooltip = "Versi terbaru belum diketahui.";
  let indicatorTone = "unknown";

  if (update.status === "current") {
    Icon = CheckCircle2;
    tooltip = "Versi ini sudah menggunakan rilis terbaru.";
    indicatorTone = "ready";
  } else if (update.status === "available") {
    Icon = CircleArrowUp;
    tooltip = `Perlu update ke ${update.latestVersion || "versi terbaru"}.`;
    indicatorTone = "available";
  } else if (update.status === "updating") {
    Icon = CircleArrowUp;
    tooltip = update.latestVersion
      ? `Sedang update ke ${update.latestVersion}.`
      : "Sedang memasang pembaruan.";
    indicatorTone = "updating";
  } else if (update.status === "failed") {
    Icon = AlertTriangle;
    tooltip = update.error || "Update gagal. Periksa log agent.";
    indicatorTone = "failed";
  } else if (toneStatus === "reconnecting") {
    Icon = CircleArrowUp;
    tooltip = "Permintaan update sudah dikirim.";
    indicatorTone = "updating";
  }

  return (
    <span className={`device-update-indicator tone-${indicatorTone}`} tabIndex={0} aria-label={tooltip}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      <span className="device-update-indicator-bubble">{tooltip}</span>
    </span>
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

function TopCommandBar({
  profile,
  loading,
  authBusy,
  onRefresh,
  onSignOut,
  notifications = [],
  notificationOpen = false,
  onNotificationToggle,
  onNotificationClose,
}) {
  const notificationCount = notifications.length;
  return (
    <header className="top-command-bar" aria-label="Status dan aksi cepat">
      <div className="workspace-switcher">
        <span className="workspace-logo" aria-hidden="true">
          <ShieldCheck size={18} strokeWidth={2.4} />
        </span>
        <div>
          <strong>{profile.display_name || "School Services"}</strong>
          <small>{profile.email || getStatusLabel(profile.role)}</small>
        </div>
      </div>
      <div className="top-command-spacer" />
      <div className="notification-anchor">
        <button
          type="button"
          className={`icon-button notification-button ${notificationOpen ? "is-active" : ""}`}
          aria-label="Buka notifikasi"
          aria-expanded={notificationOpen}
          onClick={onNotificationToggle}
        >
          <Bell size={17} strokeWidth={2.2} aria-hidden="true" />
          {notificationCount ? <span className="notification-count">{notificationCount}</span> : null}
        </button>
        <NotificationPopover open={notificationOpen} items={notifications} onClose={onNotificationClose} />
      </div>
      <ActionButton className="secondary-button" busy={loading} icon={RefreshCw} onClick={onRefresh}>
        Refresh
      </ActionButton>
      <ActionButton className="secondary-button" busy={authBusy} icon={LogOut} onClick={onSignOut}>
        Log Out
      </ActionButton>
    </header>
  );
}

function matchesDeviceQuery(device, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [device.deviceName, device.deviceAlias, device.rawDeviceName, device.deviceId]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

function formatServiceDisplayName(name) {
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

function DeviceCombobox({
  devices,
  selectedDeviceId,
  onSelect,
  label = "Perangkat",
  includeAll = false,
  allLabel = "Semua device",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const comboboxRef = useRef(null);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId) || null;
  const filteredDevices = devices.filter((device) => matchesDeviceQuery(device, query)).slice(0, 12);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnOutside(event) {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectDevice(deviceId) {
    onSelect(deviceId);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={`device-combobox ${open ? "is-open" : ""} ${className}`.trim()} ref={comboboxRef}>
      <label className="device-combobox-label">{label}</label>
      <button
        type="button"
        className="device-combobox-current"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>{selectedDevice ? selectedDevice.deviceName : allLabel}</strong>
          <small>
            {selectedDevice
              ? `${selectedDevice.deviceId}${selectedDevice.deviceAlias ? ` | Alias: ${selectedDevice.deviceAlias}` : ""}`
              : "Menampilkan seluruh perangkat"}
          </small>
        </span>
        <span className="device-combobox-current-meta">
          {selectedDevice ? (
            <StatusChip
              status={getDeviceStatusBadgeModel(selectedDevice.deviceStatus).status}
              label={getDeviceStatusBadgeModel(selectedDevice.deviceStatus).label}
            />
          ) : (
            <StatusChip status="ready" label={`${devices.length} device`} />
          )}
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="device-combobox-menu">
          <div className="device-combobox-search">
            <Search size={16} strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama device, alias, atau device id"
              aria-label={`Cari ${label.toLowerCase()}`}
            />
          </div>
          {includeAll ? (
            <button
              type="button"
              className={`device-combobox-option ${selectedDeviceId === "all" ? "is-selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectDevice("all")}
            >
              <span>
                <strong>{allLabel}</strong>
                <small>Gabungan semua perangkat</small>
              </span>
              <StatusChip status="ready" label={`${devices.length} device`} />
            </button>
          ) : null}
          {filteredDevices.length ? (
            filteredDevices.map((device) => {
              const badge = getDeviceStatusBadgeModel(device.deviceStatus);
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  className={`device-combobox-option ${device.deviceId === selectedDeviceId ? "is-selected" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectDevice(device.deviceId)}
                >
                  <span>
                    <strong>{device.deviceName}</strong>
                    <small>{device.deviceId}</small>
                    {device.deviceAlias ? <small>Alias: {device.deviceAlias}</small> : null}
                  </span>
                  <StatusChip status={badge.status} label={badge.label} />
                </button>
              );
            })
          ) : (
            <div className="device-combobox-empty">Device tidak ditemukan.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeviceWarningPanel({ device }) {
  if (!device) {
    return null;
  }

  const update = getDeviceUpdateModel(device.deviceRecord);
  const warnings = [];
  if (device.deviceStatus === "offline") {
    warnings.push("Perangkat sedang offline.");
  }
  if (device.issueCount > 0) {
    warnings.push(`${device.issueCount} layanan perlu dicek.`);
  }
  if (update.updateAvailable) {
    warnings.push(`Update agent tersedia: ${update.localVersion} -> ${update.latestVersion}.`);
  }
  if (!warnings.length) {
    return null;
  }

  return (
    <article className="device-warning-panel">
      <AlertTriangle size={19} strokeWidth={2.2} aria-hidden="true" />
      <div>
        <strong>Perhatian untuk {device.deviceName}</strong>
        <p>{warnings.join(" ")}</p>
      </div>
    </article>
  );
}

function Pagination({ page, totalItems, pageSize = 10, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return (
    <div className="pagination-bar">
      <span>
        Halaman {safePage} dari {totalPages}
      </span>
      <div>
        <IconButton
          label="Halaman sebelumnya"
          icon={ChevronsLeft}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        />
        <IconButton
          label="Halaman berikutnya"
          icon={ChevronsRight}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        />
      </div>
    </div>
  );
}

function getRemoteRootPreference(root) {
  const label = String(root?.label || root?.name || "").trim().toUpperCase();
  const path = String(root?.path || "").trim().toUpperCase();
  const combined = `${label} ${path}`;
  const priorities = [
    { key: "DAPODIK", score: 1, label: "Dapodik" },
    { key: "E-RAPOR", score: 2, label: "E-Rapor" },
    { key: "ERAPOR", score: 2, label: "E-Rapor" },
    { key: "DESKTOP", score: 3, label: "Desktop" },
    { key: "DOCUMENTS", score: 4, label: "Documents" },
    { key: "DOWNLOAD", score: 5, label: "Download" },
    { key: "VIDEOS", score: 6, label: "Videos" },
    { key: "PICTURES", score: 7, label: "Pictures" },
  ];
  const match = priorities.find((entry) => combined.includes(entry.key));
  return match || null;
}

function getPriorityBanner({ route, profile, devices, fileJobs, accounts }) {
  const onlineDevices = devices.filter((device) => device.deviceStatus !== "offline").length;
  const runningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;

  if (route.section === "files") {
    return {
      icon: FolderOpen,
      tone: "files",
      title: "File library Supabase menjadi tampilan utama.",
      description: `${runningJobs} aktivitas berjalan. Berkas dikelompokkan per bucket supaya arsip mudah dicari.`,
    };
  }
  if (route.section === "accounts" && pendingAccounts) {
    return {
      icon: UserPlus,
      tone: "warn",
      title: `${pendingAccounts} akun menunggu keputusan.`,
      description: "Setujui atau tolak akun dari daftar akun agar akses sekolah tetap terkendali.",
    };
  }
  return {
    icon: Sparkles,
    tone: "good",
    title: `${onlineDevices}/${devices.length || 0} perangkat siap dipantau.`,
    description:
      profile.role === "super_admin"
        ? "Status perangkat, akun, update, dan berkas sudah diprioritaskan dari satu dashboard."
        : "Status layanan utama ditampilkan dulu agar akses E-Rapor mudah dipastikan.",
  };
}

function PriorityBanner({ route, profile, devices, fileJobs, accounts }) {
  const banner = getPriorityBanner({ route, profile, devices, fileJobs, accounts });
  const Icon = banner.icon;
  return (
    <section className={`priority-banner tone-${banner.tone}`}>
      <span className="priority-banner-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div>
        <strong>{banner.title}</strong>
        <p>{banner.description}</p>
      </div>
    </section>
  );
}

function RouteHeader({ route, profile, breadcrumbs = [] }) {
  const copy = getRouteCopy(route.section, profile.role);
  return (
    <header className="app-route-header">
      <div>
        {breadcrumbs.length ? (
          <nav className="route-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`} className="route-breadcrumb-item">
                {index > 0 ? <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
                <span>{item.label}</span>
              </span>
            ))}
          </nav>
        ) : null}
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
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
        ["Perangkat aktif", `${onlineDevices}/${devices.length}`, "Perangkat yang tersambung saat ini.", Monitor],
        ["Layanan aktif", runningServices, "Layanan yang siap digunakan.", Server],
        ["Perlu perhatian", issueCount, "Perangkat atau layanan yang perlu dicek.", AlertTriangle],
        ["Proses berkas", runningJobs, "Aktivitas berkas yang sedang berlangsung.", FileText],
        ["Akun menunggu", pendingAccounts, "Akun yang menunggu persetujuan.", Users],
      ].map(([label, value, helper, icon]) => (
        <MetricTile key={label} label={label} value={value} helper={helper} icon={icon} />
      ))}
      <MetricTile
        label="Update data"
        value={formatRelativeTime(new Date(now).toISOString(), now)}
        helper="Data diperbarui otomatis tanpa memuat ulang halaman."
        icon={RefreshCw}
      />
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
          <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={28} />
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

function getUpdateStatusSummary(update) {
  if (update.status === "current") {
    return "Versi agent sudah sinkron dengan rilis terbaru.";
  }
  if (update.status === "available") {
    return `Update ${update.latestVersion || "terbaru"} siap dipasang dari panel ini.`;
  }
  if (update.status === "updating") {
    return "Agent sedang memasang pembaruan. Tunggu sampai layanan aktif kembali.";
  }
  if (update.status === "failed") {
    return "Update terakhir gagal. Periksa detail error agent.";
  }
  return "Versi agent perangkat ini belum dilaporkan ke dashboard.";
}

function formatCommandTargetLabel(serviceName) {
  if (!serviceName) {
    return "agent";
  }
  const name = formatServiceDisplayName(serviceName);
  return `layanan ${name}`;
}

function getCommandCopy(action, serviceName, versionLabel = "") {
  const target = formatCommandTargetLabel(serviceName);

  if (action === "start") {
    return {
      pending: `Menyalakan ${target}. Progress akan mengikuti status service secara realtime.`,
      success: `${target} sudah aktif kembali.`,
    };
  }
  if (action === "stop") {
    return {
      pending: `Menghentikan ${target}. Hanya layanan ini yang akan dihentikan.`,
      success: `${target} sudah berhenti.`,
    };
  }
  if (action === "agent_start") {
    return {
      pending: "Menyalakan agent dan seluruh layanan yang dikelola.",
      success: "Agent dan seluruh layanan utama sudah aktif.",
    };
  }
  if (action === "agent_stop") {
    return {
      pending: "Menghentikan layanan agent yang dikelola. Konektivitas heartbeat tetap dipertahankan.",
      success: "Layanan agent sudah dihentikan tanpa memutus heartbeat perangkat.",
    };
  }
  if (action === "agent_restart") {
    return {
      pending: "Merestart agent dan memulai ulang seluruh layanan hingga siap kembali.",
      success: "Restart agent selesai dan layanan utama sudah aktif lagi.",
    };
  }
  if (action === "update") {
    return {
      pending: `Update agent${versionLabel ? ` ke ${versionLabel}` : ""} sedang dipersiapkan.`,
      success: "Update agent selesai.",
    };
  }
  return {
    pending: "Perintah sedang diproses.",
    success: "Perintah selesai dijalankan.",
  };
}

function getCommandProgressTarget(action) {
  if (action === "stop" || action === "agent_stop") {
    return "stopped";
  }
  return "running";
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
  onFeedback = null,
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
      if (typeof onFeedback === "function") {
        onFeedback("Tautan berhasil disalin.", "success");
      }
    } catch (error) {
      const message = error?.message || "Gagal menyalin tautan.";
      setFeedback("");
      if (typeof onActionComplete === "function") {
        onActionComplete(message);
      }
      if (typeof onFeedback === "function") {
        onFeedback(message, "error");
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
    if (typeof onFeedback === "function") {
      onFeedback("Tautan siap dibagikan lewat WhatsApp.", "success");
    }
  }

  return (
    <div className={`link-action-stack ${compact ? "link-action-stack-compact" : ""}`}>
      <div className="panel-actions public-link-actions">
        <ActionButton
          className="secondary-button"
          disabled={disabled}
          icon={Copy}
          onClick={handleCopy}
        >
          Salin tautan
        </ActionButton>
        <ActionButton
          className="secondary-button"
          disabled={disabled}
          icon={Share2}
          onClick={handleWhatsAppShare}
        >
          Bagikan WhatsApp
        </ActionButton>
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
  const inputId = useId();
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
    <div className="password-field">
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <div className="password-input-shell">
        <input
          id={inputId}
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
    </div>
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
          <MaskedTextField
            label="Email"
            type="email"
            mask="email"
            value={email}
            onChange={setEmail}
            placeholder="Example@gmail.com"
            autoComplete="username"
            disabled={loading}
            inputMode="email"
          />
          {mode === "register" ? (
            <>
              <MaskedTextField
                label="Nama"
                value={displayName}
                onChange={setDisplayName}
                placeholder="Siti Aminah"
                disabled={loading}
                maxLength={80}
                mask="alias"
              />
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
                    <MaskedTextField
                      label="Kode lingkungan"
                      value={referralCode}
                      onChange={setReferralCode}
                      placeholder="ABCD-123456"
                      disabled={loading}
                      mask="referral"
                      inputMode="text"
                      maxLength={13}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="********"
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
      await legacyDataClient.auth.signOut({ scope: "global" }).catch(() =>
        legacyDataClient.auth.signOut({ scope: "local" }).catch(() => {})
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
    <section className="panel-stack profile-panel-shell">
      <article className="service-panel profile-summary-panel">
        <div className="panel-heading-row">
          <h3>Profil</h3>
          <div className="service-status-group">
            <StatusChip status={profile?.status || "unknown"} />
            {profile?.role ? <StatusChip status={profile.role} /> : null}
          </div>
        </div>
        <div className="profile-identity-grid">
          <ProfileInfoField label="Nama" value={profile?.display_name || "-"} />
          <ProfileInfoField label="Email" value={profile?.email || session?.user?.email || ""} />
          <ProfileInfoField label="ID akun" value={session?.user?.id || ""} mono />
        </div>
      </article>

      <article className="service-panel profile-password-panel">
        <div className="panel-heading-row">
          <h3>Ganti Password</h3>
        </div>
        <div className="profile-password-grid">
          <PasswordField
            label="Password saat ini"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="********"
            autoComplete="current-password"
            disabled={busy}
          />
          <PasswordField
            label="Password baru"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="8 karakter atau lebih"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="8 karakter atau lebih"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
        </div>
        <div className="profile-password-actions">
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
      const { data, error: invokeError } = await legacyDataClient.functions.invoke("guest-access", {
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
      legacyDataClient.removeChannel(channel);
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
      const { data, error: invokeError } = await legacyDataClient.functions.invoke("guest-access", {
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
          <GuestStatusSkeleton />
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
                  <LongText value={state.device?.deviceId || ""} label="ID perangkat" className="mono" maxLength={32} />
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
                      <LongText value={service.public_url} href={service.public_url} label="Tautan E-Rapor" maxLength={54} />
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
                  <strong className="mono">
                    <LongText value={service?.resolved_path || ""} label="Lokasi aplikasi" maxLength={48} />
                  </strong>
                </div>
              </div>

              {service?.location_details?.message ? (
                <div className="service-note">
                  <LongText value={service.location_details.message} label="Detail lokasi" maxLength={72} />
                </div>
              ) : null}
              {service?.last_error ? (
                <div className="job-error">
                  <LongText value={service.last_error} label="Error layanan" maxLength={72} />
                </div>
              ) : null}

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
            <Skeleton className="modal-skeleton-icon" />
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
        const { error } = await legacyDataClient.auth.exchangeCodeForSession(code);
        recoveryError = error;
      } else if (accessToken && refreshToken) {
        const { error } = await legacyDataClient.auth.setSession({
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
      const { error } = await legacyDataClient.auth.updateUser({ password: passwordValue });
      if (error) {
        throw error;
      }
      await legacyDataClient.auth.signOut({ scope: "global" }).catch(() =>
        legacyDataClient.auth.signOut({ scope: "local" }).catch(() => {})
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
            placeholder="8 karakter atau lebih"
            autoComplete="new-password"
            disabled={busy}
            visible={showPasswords}
            onToggleVisibility={() => setShowPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="8 karakter atau lebih"
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
            <div className="device-list-meta mono">
              <LongText value={device.deviceId} label="ID perangkat" maxLength={24} />
            </div>
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
  const summary = getUpdateStatusSummary(update);
  const remoteUpdateSupported = supportsRemoteUpdate(deviceRecord);
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
      <div className="device-update-head">
        <span className="device-update-icon" aria-hidden="true">
          <Rocket size={18} strokeWidth={2.2} />
        </span>
        <div className="device-update-summary">
          <div className="device-update-topline">
            <span className="device-update-title">Versi & update</span>
            <DeviceUpdateStatusIndicator update={update} toneStatus={toneStatus} />
          </div>
          <strong className="device-update-version">{update.localVersion}</strong>
          <small className="device-update-note">{summary}</small>
        </div>
      </div>
      {showAction && canUpdate ? (
        <ActionButton
          className="primary-button device-update-action"
          busy={busy}
          disabled={busy}
          onClick={onUpdate}
        >
          Update Agent & Service
        </ActionButton>
      ) : null}
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
    <div className="guest-modal-backdrop" role="status" aria-live="polite" onMouseDown={(event) => dismissOnBackdrop(event, canClose ? onClose : undefined)}>
      <div className="guest-modal-card update-progress-card">
        <div className={`update-progress-orb tone-${model.status}`}>
          <span className="update-progress-core" aria-hidden="true" />
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
          <div className="root-card-path mono">
            <LongText value={root.path} label="Path lokasi" maxLength={42} />
          </div>
          {root.metadata?.message ? (
            <div className="root-card-note">
              <LongText value={root.metadata.message} label="Pesan lokasi" maxLength={64} />
            </div>
          ) : null}
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
  loading = false,
  loadingLabel = "",
  loadingProgress = null,
  virtualRootLabel = "",
}) {
  if (loading) {
    return (
      <div className="explorer-shell explorer-loading-shell" aria-busy="true">
        <Skeleton lines={4} />
        {loadingLabel ? <div className="explorer-loading-copy">{loadingLabel}</div> : null}
        {loadingProgress ? (
          <div className="explorer-loading-progress" aria-label={`${loadingProgress.label} ${loadingProgress.percent}%`}>
            <div className="explorer-loading-progress-track">
              <span style={{ width: `${loadingProgress.percent}%` }} />
            </div>
            <small>{loadingProgress.label}</small>
          </div>
        ) : null}
      </div>
    );
  }

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
  const showingVirtualRoot = !currentPath && virtualRootLabel;

  return (
    <div className="explorer-shell">
      <div className="explorer-toolbar">
        <div className="explorer-breadcrumbs">
          {showingVirtualRoot ? (
            <span className="breadcrumb-chip breadcrumb-chip-active">{virtualRootLabel}</span>
          ) : (
            <>
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
            </>
          )}
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
                  item.type === "directory" ? onOpen(item.path) : onToggle(item)
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
                      item.type === "directory" ? onOpen(item.path) : onToggle(item)
                    }
                  >
                    {getItemGlyph(item)}
                  </button>
                  <div className="file-name-content">
                    <button
                      type="button"
                      className="file-link"
                      onClick={() =>
                        item.type === "directory" ? onOpen(item.path) : onToggle(item)
                      }
                    >
                      {item.name}
                    </button>
                    <div className="file-subpath mono">
                      <LongText value={item.path} label="Path file" maxLength={46} />
                    </div>
                  </div>
                </div>
                <span>{item.virtualKind ? String(item.virtualKind).replace(/_/g, " ") : getFileKindLabel(item)}</span>
                <span>{item.type === "directory" ? "-" : formatBytes(item.size)}</span>
                <span>{item.description || formatDate(item.modifiedAt)}</span>
                <button
                  type="button"
                  className={`utility-button ${item.type === "directory" ? "open-folder-button" : ""}`}
                  onClick={() =>
                    item.type === "directory" ? onOpen(item.path) : onToggle(item)
                  }
                >
                  {item.type === "directory" ? "Buka folder" : selected ? "Batalkan" : "Pilih"}
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
          <div className="job-card-path mono">
            <LongText value={job.source_path || job.destination_path || ""} label="Path aktivitas" maxLength={54} />
          </div>
          {job.result?.fileName ? (
            <div className="job-card-path mono">
              <LongText value={job.result.fileName} label="Nama file" maxLength={54} />
            </div>
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
          {job.error ? (
            <div className="job-error">
              <LongText value={job.error} label="Error aktivitas" maxLength={72} />
            </div>
          ) : null}
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
  const bucketLabels = {
    "agent-temp-artifacts": "Berkas sementara",
    "agent-archives": "Arsip permanen",
    "agent-preview-cache": "Cache pratinjau",
    "admin-upload-staging": "Unggahan admin",
  };
  const groupedBuckets = buckets
    .map((bucket) => {
      const files = artifacts.filter((artifact) => String(artifact.bucket || "") === bucket);
      const totalSize = files.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0);
      const deviceCount = new Set(
        files.map((artifact) => artifact.deviceId || artifact.device_id || artifact.deviceName).filter(Boolean)
      ).size;
      return { bucket, files, totalSize, deviceCount };
    })
    .filter((group) => bucketFilter === "all" || group.bucket === bucketFilter);

  return (
    <article className="jobs-panel artifact-inventory-panel file-library-panel">
      <SectionHeader
        eyebrow="Storage"
        title="Pustaka berkas"
        description="Berkas dikelompokkan berdasarkan bucket storage. Aktivitas proses tetap tersedia di bagian riwayat."
        actions={
          <ActionButton
            className="secondary-button"
            busy={busyAction === "artifacts:refresh"}
            icon={RefreshCw}
            onClick={onRefresh}
          >
            Segarkan bucket
          </ActionButton>
        }
      />

      <div className="artifact-filter-bar file-library-filters">
        <label>
          <span>Bucket</span>
          <select value={bucketFilter} onChange={(event) => onBucketFilter(event.target.value)}>
            <option value="all">Semua bucket</option>
            {buckets.map((bucket) => (
              <option key={bucket} value={bucket}>{bucketLabels[bucket] || bucket}</option>
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
            placeholder="rapor-2026.zip"
          />
        </label>
      </div>

      <div className="file-bucket-grid">
        {groupedBuckets.map((group) => (
          <article key={group.bucket} className="file-bucket-card">
            <div>
              <span className="section-eyebrow">{group.bucket}</span>
              <strong>{bucketLabels[group.bucket] || group.bucket}</strong>
            </div>
            <div className="file-bucket-stats">
              <span>{group.files.length} berkas</span>
              <span>{group.deviceCount || 0} device</span>
              <span>{formatBytes(group.totalSize)}</span>
            </div>
          </article>
        ))}
      </div>

      {artifacts.length === 0 ? (
        <div className="empty-state">Belum ada berkas Supabase yang cocok dengan filter ini.</div>
      ) : (
        <div className="file-library-groups">
          {groupedBuckets.map((group) => (
            <section key={group.bucket} className="file-library-group">
              <div className="panel-heading-row">
                <div>
                  <h3>{bucketLabels[group.bucket] || group.bucket}</h3>
                  <div className="root-card-note">{group.files.length} berkas dari bucket {group.bucket}</div>
                </div>
                <StatusChip status={group.files.length ? "ready" : "unknown"} label={`${group.files.length} berkas`} />
              </div>
              {group.files.length === 0 ? (
                <div className="empty-state compact-empty">Tidak ada berkas di bucket ini untuk filter aktif.</div>
              ) : (
                <div className="file-library-list">
                  {group.files.map((artifact) => {
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
                      <article key={artifact.id || `${artifact.bucket}:${artifact.objectKey}`} className={`file-library-row tone-${statusTone(artifact.status)}`}>
                        <div className="file-library-main">
                          <FileText size={18} aria-hidden="true" />
                          <div>
                            <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                            <LongText
                              value={artifact.sourcePath || artifact.objectKey || ""}
                              label="Path berkas"
                              className="mono"
                              maxLength={58}
                            />
                          </div>
                        </div>
                        <div className="file-library-meta">
                          <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                          <span>{formatBytes(Number(artifact.size || 0))}</span>
                          <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                        </div>
                        <div className="artifact-actions">
                          <StatusChip status={artifact.status || "unknown"} />
          {canDownload ? (
                            <ActionButton className="primary-button" icon={Download} onClick={() => onDownload(downloadJob)}>
                              Unduh
                            </ActionButton>
                          ) : null}
                          {canDownload ? (
                            <ActionButton
                              className="danger-button"
                              icon={Trash2}
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
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function SupabaseFileTable({
  artifacts,
  page,
  onPageChange,
  busyAction,
  onDownload,
  onDelete,
}) {
  const [detailArtifact, setDetailArtifact] = useState(null);
  const pageSize = 10;
  const safePage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(artifacts.length / pageSize)));
  const pageItems = artifacts.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <article className="fresh-panel supabase-file-table-panel">
      <SectionHeader
        eyebrow="Storage"
        title="Pustaka berkas"
        description="Seluruh artefak yang sudah diambil dari perangkat dan tersimpan di storage pusat."
      />
      {artifacts.length ? (
        <>
          <div className="supabase-file-table" role="table" aria-label="Daftar berkas storage">
            <div className="supabase-file-row supabase-file-head" role="row">
              <span>Nama file/folder</span>
              <span>Path</span>
              <span>Waktu diambil</span>
              <span>Device</span>
              <span>Size</span>
              <span>Status</span>
              <span>Aksi</span>
            </div>
            {pageItems.map((artifact) => {
              const key = artifact.id || `${artifact.bucket}:${artifact.objectKey}`;
              const downloadJob = {
                id: artifact.jobId || artifact.id,
                artifact_bucket: artifact.bucket,
                artifact_object_key: artifact.objectKey,
                result: {
                  fileName: artifact.fileName,
                  size: artifact.size,
                  parts: artifact.result?.parts,
                },
              };
              const canDelete = artifact.bucket && artifact.objectKey && artifact.status !== "deleted";
              const canDownload = canDelete && !artifact.isFolder;
              return (
                <article key={key} className={`supabase-file-row tone-${statusTone(artifact.status)}`} role="row">
                  <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                  <LongText
                    value={artifact.sourcePath || artifact.objectKey || ""}
                    label="Path lengkap berkas"
                    className="mono"
                    maxLength={46}
                  />
                  <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                  <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                  <span>{formatBytes(Number(artifact.size || 0))}</span>
                  <StatusChip status={artifact.status || "unknown"} />
                  <div className="fresh-actions">
                    <ActionButton className="secondary-button" icon={Eye} onClick={() => setDetailArtifact(artifact)}>
                      Detail
                    </ActionButton>
                    {canDownload ? (
                      <ActionButton className="primary-button" icon={Download} onClick={() => onDownload(downloadJob)}>
                        Unduh
                      </ActionButton>
                    ) : null}
                    {canDelete ? (
                      <ActionButton
                        className="danger-button"
                        icon={Trash2}
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
          <Pagination page={safePage} totalItems={artifacts.length} pageSize={pageSize} onPageChange={onPageChange} />
        </>
      ) : (
        <EmptyState title="Belum ada berkas" description="Artefak storage yang cocok dengan filter akan tampil di sini." />
      )}
      {detailArtifact ? (
        <DetailDrawer
          title={detailArtifact.fileName || safeFileNameFromKey(detailArtifact.objectKey) || "Detail berkas"}
          value={formatArtifactDetailValue(detailArtifact)}
          onClose={() => setDetailArtifact(null)}
        />
      ) : null}
    </article>
  );
}

function FloatingFileActivity({ jobs, open, expanded, onToggleOpen, onToggleExpanded, onDownload }) {
  const visibleJobs = jobs.filter((job) =>
    ["download_file", "archive_paths", "upload_place", "preview_file"].includes(job.job_type || job.type || "")
  );
  return (
    <aside className={`floating-file-activity ${open ? "is-open" : "is-minimized"} ${expanded ? "is-expanded" : ""}`}>
      <button type="button" className="floating-file-activity-tab" onClick={onToggleOpen}>
        <FileText size={16} aria-hidden="true" />
        <span>Aktivitas Berkas</span>
        <StatusChip status={visibleJobs.some((job) => ["pending", "running"].includes(job.status)) ? "running_job" : "ready"} label={String(visibleJobs.length)} />
      </button>
      {open ? (
        <div className="floating-file-activity-panel">
          <div className="floating-file-activity-head">
            <strong>Riwayat transfer</strong>
            <IconButton
              label={expanded ? "Minimize riwayat" : "Maksimize riwayat"}
              icon={expanded ? PanelLeftClose : PanelLeftOpen}
              onClick={onToggleExpanded}
            />
          </div>
          <div className="floating-file-activity-list">
            {visibleJobs.length ? (
              visibleJobs.slice(0, expanded ? 12 : 5).map((job) => (
                <article key={job.id} className={`floating-file-job tone-${statusTone(job.status)}`}>
                  <div>
                    <strong>{getActivityLabel(job.job_type || job.type || "transfer")}</strong>
                    <LongText value={job.source_path || job.result?.fileName || job.artifact_object_key || ""} label="Path aktivitas berkas" className="mono" maxLength={32} />
                  </div>
                  <div className="fresh-pill-group">
                    <StatusChip status={job.status} />
                    {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
                      <IconButton label="Unduh artifact" icon={Download} onClick={() => onDownload(job)} />
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="Belum ada transfer" description="Aktivitas download/upload akan muncul di sini." />
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function LogOverlay({ open, logs, jobs = [], deviceId, onClose }) {
  if (!open) {
    return null;
  }

  const scopedLogs = logs.filter((log) => !deviceId || deviceId === "all" || log.device_id === deviceId);
  const scopedJobs = jobs.filter((job) => !deviceId || deviceId === "all" || job.device_id === deviceId);
  return (
    <div className="detail-drawer-backdrop log-overlay-backdrop" role="dialog" aria-modal="true" aria-labelledby="log-overlay-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <section className="log-overlay-card">
        <div className="detail-drawer-header">
          <div>
            <span className="section-eyebrow">Log</span>
            <strong id="log-overlay-title">Log aktivitas {deviceId && deviceId !== "all" ? deviceId : "semua device"}</strong>
          </div>
          <IconButton label="Tutup log" icon={X} onClick={onClose} />
        </div>
        <div className="log-overlay-list">
          {scopedJobs.length ? (
            <section className="log-overlay-section">
              <span className="section-eyebrow">Riwayat berkas</span>
              {scopedJobs.map((job) => (
                <article key={job.id} className={`fresh-timeline-row tone-${statusTone(job.status)}`}>
                  <span className="fresh-timeline-dot" />
                  <div>
                    <strong>{getActivityLabel(job.job_type || "transfer")}</strong>
                    <small className="mono">{formatDate(job.created_at || job.updated_at)} | {job.device_id}</small>
                    <LongText value={job.source_path || job.artifact_object_key || job.result?.fileName || ""} label="Path riwayat berkas" className="mono" maxLength={110} />
                  </div>
                  <StatusChip status={job.status} />
                </article>
              ))}
            </section>
          ) : null}
          {scopedLogs.length ? (
            scopedLogs.map((log) => (
              <article key={log.id} className={`fresh-timeline-row tone-${statusTone(log.level)}`}>
                <span className="fresh-timeline-dot" />
                <div>
                  <strong><LongText value={log.message} label="Pesan log" maxLength={96} /></strong>
                  <small className="mono">{formatDate(log.created_at)} | {log.device_id} | {log.service_name || "system"}</small>
                  {log.details ? <LongText value={JSON.stringify(log.details, null, 2)} label="Detail log" className="mono" maxLength={110} /> : null}
                </div>
                <StatusChip status={log.level} />
              </article>
            ))
          ) : (
            <EmptyState title="Belum ada log" description="Log untuk scope ini belum tersedia." />
          )}
        </div>
      </section>
    </div>
  );
}

function AccountTable({ accounts, page, onPageChange, busyAction, onAction, onDelete, isSuperAdmin }) {
  const pageSize = 10;
  const safePage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(accounts.length / pageSize)));
  const pageItems = accounts.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <div className="account-table-wrap">
      {accounts.length ? (
        <>
          <div className="account-table" role="table" aria-label="Daftar akun">
            <div className="account-table-row account-table-head" role="row">
              <span>Akun</span>
              <span>Role</span>
              <span>Status</span>
              <span>Dibuat</span>
              <span>Lingkungan</span>
              <span>Aksi</span>
            </div>
            {pageItems.map((account) => (
              <article key={account.user_id} className={`account-table-row tone-${statusTone(account.status)}`} role="row">
                <div>
                  <strong>{account.display_name || account.email}</strong>
                  <LongText value={account.email} label="Email akun" className="mono" maxLength={34} />
                </div>
                <StatusChip status={account.role} />
                <StatusChip status={account.status} />
                <span>{formatDate(account.created_at)}</span>
                <span>{account.membership?.status ? getStatusLabel(account.membership.status) : "-"}</span>
                <div className="fresh-actions">
                  {account.status !== "approved" ? (
                    <ActionButton className="primary-button" busy={busyAction === "account:approveAccount"} onClick={() => onAction("approveAccount", { userId: account.user_id })}>
                      Setujui
                    </ActionButton>
                  ) : null}
                  {account.status === "pending" ? (
                    <ActionButton className="danger-button" busy={busyAction === "account:rejectAccount"} onClick={() => onAction("rejectAccount", { userId: account.user_id, reason: "Permintaan akun belum dapat disetujui." })}>
                      Tolak
                    </ActionButton>
                  ) : null}
                  {account.status !== "disabled" ? (
                    <ActionButton className="secondary-button" busy={busyAction === "account:disableAccount"} onClick={() => onAction("disableAccount", { userId: account.user_id })}>
                      Nonaktifkan
                    </ActionButton>
                  ) : null}
                  <ActionButton className="secondary-button" busy={busyAction === "account:resetPassword"} onClick={() => onAction("resetPassword", { email: account.email })}>
                    Reset password
                  </ActionButton>
                  {isSuperAdmin && ["operator", "user"].includes(account.role) ? (
                    <ActionButton className="danger-button" busy={busyAction === "account:deleteAccount"} onClick={() => onDelete(account)}>
                      Hapus akun
                    </ActionButton>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <Pagination page={safePage} totalItems={accounts.length} pageSize={pageSize} onPageChange={onPageChange} />
        </>
      ) : (
        <EmptyState title="Belum ada akun" description="Akun yang terdaftar akan muncul di sini." />
      )}
    </div>
  );
}

function LegacyArtifactInventory({
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
    <article className="jobs-panel artifact-inventory-panel legacy-artifact-inventory">
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
            placeholder="rapor-2026.zip"
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
                  <LongText
                    value={artifact.sourcePath || artifact.objectKey || ""}
                    label="Path artifact"
                    className="mono"
                    maxLength={54}
                  />
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
    <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-alias-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <div className="guest-modal-card dashboard-modal-card">
        <strong id="device-alias-title">Ubah nama tampilan perangkat</strong>
        <p>
          Nama tampilan hanya berlaku untuk akun Anda. Nama asli perangkat tetap tersimpan sebagai{" "}
          <LongText
            value={device.deviceRecord?.device_name || device.deviceId}
            label="Nama asli perangkat"
            className="mono"
            maxLength={32}
          />
          .
        </p>
        <MaskedTextField
          label="Nama tampilan"
          value={value}
          maxLength={80}
          onChange={onChange}
          placeholder="Server TU"
          mask="alias"
        />
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
    <div className="guest-modal-backdrop modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="transfer-history-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <div className="guest-modal-card transfer-modal-card">
        <div className="modal-title-row">
          <div>
            <strong id="transfer-history-title">Riwayat Berkas</strong>
            <p>
              Berkas yang pernah diproses untuk{" "}
              <LongText value={contextLabel} label="Konteks riwayat" className="mono" maxLength={32} />.
            </p>
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
                        <div className="mono">
                          Aktivitas #{job.id} ·{" "}
                          <LongText value={job.device_id} label="ID perangkat" maxLength={24} />
                        </div>
                      </div>
                      <StatusChip status={job.status} />
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(job.created_at)}</span>
                      <span>{job.delivery_mode === "temp" || !job.delivery_mode ? "Sementara" : job.delivery_mode}</span>
                      <span>{formatBytes(Number(job.artifact_size || job.result?.size || 0))}</span>
                    </div>
                    <div className="root-card-note">
                      <LongText
                        value={job.source_path || job.destination_path || job.result?.fileName || ""}
                        label="Path riwayat"
                        maxLength={52}
                        empty="Detail path tidak tersedia."
                      />
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
                        <div className="mono">
                          <LongText
                            value={`${audit.device_id} · ${audit.job_id ? `Aktivitas #${audit.job_id}` : "sistem"}`}
                            label="Sumber audit"
                            maxLength={40}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(audit.created_at)}</span>
                      <LongText value={audit.target_path || ""} label="Target audit" maxLength={44} empty="target tidak tersedia" />
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
  const [toastItems, setToastItems] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [appRoute, setAppRoute] = useState(() =>
    typeof window === "undefined" ? { section: "overview", deviceId: "" } : parseAppRoute(window.location.pathname)
  );
  const [now, setNow] = useState(Date.now());
  const [busyAction, setBusyAction] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [directoryJobId, setDirectoryJobId] = useState(null);
  const [rootDiscoveryJobId, setRootDiscoveryJobId] = useState(null);
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
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [fleetSearch, setFleetSearch] = useState("");
  const [fleetPage, setFleetPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [accountPage, setAccountPage] = useState(1);
  const [activityDeviceId, setActivityDeviceId] = useState("");
  const [fileActivityOpen, setFileActivityOpen] = useState(false);
  const [fileActivityExpanded, setFileActivityExpanded] = useState(false);
  const [logOverlayOpen, setLogOverlayOpen] = useState(false);
  const [filesView, setFilesView] = useState("storage");
  const [deleteArtifactTarget, setDeleteArtifactTarget] = useState(null);
  const [pendingCommandStates, setPendingCommandStates] = useState([]);
  const [updateModal, setUpdateModal] = useState({
    open: false,
    deviceId: "",
    title: "Mengupdate Agent & Service",
    message: "",
    error: "",
  });
  const fileInputRef = useRef(null);

  function dismissToast(id) {
    setToastItems((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(title, message = "", tone = "info") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToastItems((current) => [...current, { id, title, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToastItems((current) => current.filter((item) => item.id !== id));
    }, 3600);
  }

  function handleInlineFeedback(message, tone = "info") {
    if (!message) {
      return;
    }
    if (tone === "error") {
      setError(message);
      pushToast("Aksi gagal", message, "error");
      return;
    }
    setError("");
    setDashboardInfo(message);
    pushToast("Aksi berhasil", message, "success");
  }

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
    setToastItems([]);
    setSelectedDeviceId("all");
    setAppRoute({ section: "overview", deviceId: "" });
    setBusyAction("");
    setCurrentPath("");
    setDirectoryJobId(null);
    setRootDiscoveryJobId(null);
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
    setFleetPage(1);
    setFilesView("storage");
    setDeleteArtifactTarget(null);
    setPendingCommandStates([]);
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

  function syncGlobalDeviceSelection(deviceId, options = {}) {
    const nextDeviceId = String(deviceId || "all").trim() || "all";
    const syncStorageFilter = options.syncStorageFilter !== false;
    const syncActivityFilter = options.syncActivityFilter !== false;

    setSelectedDeviceId(nextDeviceId);
    if (syncStorageFilter) {
      setArtifactDeviceFilter(nextDeviceId);
    }
    if (syncActivityFilter) {
      setActivityDeviceId(nextDeviceId);
    }

    if (appRoute.section === "devices") {
      if (nextDeviceId === "all") {
        navigateRoute("overview", {}, { replace: true });
      } else if (appRoute.deviceId !== nextDeviceId) {
        navigateRoute("devices", { deviceId: nextDeviceId }, { replace: true });
      }
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

    legacyDataClient.auth
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
    } = legacyDataClient.auth.onAuthStateChange((event, nextSession) => {
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
          legacyDataClient.auth.signOut().catch(() => {});
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

  async function loadAll(options = false) {
    if (!session || guestDeviceId) {
      return;
    }

    const background =
      typeof options === "object" && options !== null
        ? Boolean(options.background)
        : Boolean(options);
    const includeArtifacts =
      typeof options === "object" && options !== null && Object.prototype.hasOwnProperty.call(options, "includeArtifacts")
        ? Boolean(options.includeArtifacts)
        : profile?.role === "super_admin" && selectedTab === "files" && filesView === "storage";

    if (!background) {
      setLoading(true);
    }

    try {
      const [dashboard, artifactPayload] = await Promise.all([
        invokeAdmin("listDashboard"),
        includeArtifacts
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
      loadAll({
        background: true,
        includeArtifacts: selectedTab === "files" && filesView === "storage",
      });
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [session, profile?.role, guestDeviceId, selectedTab, filesView]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId) {
      return;
    }
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      syncGlobalDeviceSelection("all");
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
      syncGlobalDeviceSelection(appRoute.deviceId);
    }
  }, [appRoute, selectedDeviceId]);

  useEffect(() => {
    const syncedDeviceId = selectedDeviceId || "all";
    setArtifactDeviceFilter((current) => (current === syncedDeviceId ? current : syncedDeviceId));
    setActivityDeviceId((current) => (current === syncedDeviceId ? current : syncedDeviceId));
  }, [selectedDeviceId]);

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
  const activeCommandExecution =
    pendingCommandStates[0] ||
    (/:(start|stop|agent_start|agent_stop|agent_restart|update)$/.test(busyAction)
      ? {
          action: busyAction.split(":").pop() || "command",
          deviceId: busyAction.split(":")[0] || "",
          serviceName: busyAction.split(":").length > 2 ? busyAction.split(":")[1] : "",
        }
      : null);
  const commandExecutionActive = Boolean(activeCommandExecution);
  const commandProgressMessage = activeCommandExecution
    ? getCommandCopy(
        activeCommandExecution.action,
        activeCommandExecution.serviceName,
        selectedDevice ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion : ""
      ).pending
    : "";
  const commandExecutionProgress = pendingCommandStates.length
    ? Math.min(92, 36 + pendingCommandStates.length * 18)
    : commandExecutionActive
      ? 24
      : 0;
  const fileExplorerBusy =
    busyAction.startsWith("job:list_directory") ||
    busyAction.startsWith("job:discover_roots") ||
    busyAction.startsWith("job:preview_file") ||
    directoryJobId !== null ||
    rootDiscoveryJobId !== null;
  const routeBreadcrumbs = getRouteBreadcrumbs(appRoute, profile, {
    filesView,
    deviceName:
      appRoute.section === "devices"
        ? selectedDevice?.deviceName
        : appRoute.section === "activity" && activityDeviceId && activityDeviceId !== "all"
          ? deviceEntries.find((entry) => entry.deviceId === activityDeviceId)?.deviceName || activityDeviceId
          : "",
  });

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
  const selectedDeviceDriveRoots = useMemo(
    () => selectedDeviceRoots.filter((root) => String(root.root_type || "") === "drive"),
    [selectedDeviceRoots]
  );
  const deviceScopedOffline =
    Boolean(selectedDevice) &&
    selectedDevice.deviceStatus === "offline" &&
    ["devices", "files", "activity"].includes(selectedTab);

  useEffect(() => {
    if (!pendingCommandStates.length) {
      return;
    }

    const resolved = [];
    const remaining = [];

    for (const item of pendingCommandStates) {
      const device = deviceEntries.find((entry) => entry.deviceId === item.deviceId);
      const targetStatus = item.targetStatus || "running";

      if (!device) {
        remaining.push(item);
        continue;
      }

      let done = false;
      if (item.scope === "service" && item.serviceName) {
        const service = device.services.find((entry) => entry.service_name === item.serviceName);
        done = Boolean(
          service &&
          (targetStatus === "running"
            ? service.serviceStatus === "running" && service.desired_state !== "stopped"
            : ["stopped", "offline", "blocked"].includes(service.serviceStatus) && service.desired_state === "stopped")
        );
      } else {
        done = device.services.length
          ? device.services.every((service) =>
              targetStatus === "running"
                ? service.serviceStatus === "running" && service.desired_state !== "stopped"
                : ["stopped", "offline", "blocked"].includes(service.serviceStatus) && service.desired_state === "stopped"
            )
          : false;
      }

      if (done) {
        resolved.push(item);
      } else {
        remaining.push(item);
      }
    }

    if (resolved.length) {
      for (const item of resolved) {
        pushToast("Aksi selesai", item.successMessage, "success");
        if (selectedDevice?.deviceId === item.deviceId) {
          setDashboardInfo(item.successMessage);
        }
      }
      setPendingCommandStates(remaining);
    }
  }, [deviceEntries, pendingCommandStates, selectedDevice?.deviceId]);

  useEffect(() => {
    setCurrentPath("");
    setDirectoryResult(null);
    setSelectedPaths([]);
  }, [selectedDevice?.deviceId]);

  useEffect(() => {
    if (!selectedDevice || selectedTab !== "files" || filesView !== "remote") {
      return;
    }
    refreshRoots();
  }, [selectedDevice?.deviceId, selectedTab, filesView]);

  useEffect(() => {
    if (!selectedDevice || selectedTab !== "files" || filesView !== "remote") {
      return;
    }
    if (currentPath || directoryJobId || rootDiscoveryJobId || !selectedDeviceRoots.length) {
      return;
    }
    setDirectoryResult(buildThisPcDirectoryResult(selectedDeviceDriveRoots.length ? selectedDeviceDriveRoots : selectedDeviceRoots));
  }, [
    selectedDevice?.deviceId,
    selectedDeviceRoots,
    selectedDeviceDriveRoots,
    currentPath,
    directoryJobId,
    rootDiscoveryJobId,
    selectedTab,
    filesView,
  ]);

  useEffect(() => {
    setFilePage(1);
  }, [artifactBucketFilter, artifactDeviceFilter, artifactSearch]);

  useEffect(() => {
    setFleetPage(1);
  }, [fleetSearch]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [appRoute.section, appRoute.deviceId, filesView]);

  useEffect(() => {
    setAccountPage(1);
  }, [accounts.length]);

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
    if (!rootDiscoveryJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === rootDiscoveryJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed") {
      setRootDiscoveryJobId(null);
      loadAll({ background: true, includeArtifacts: false });
    } else if (job.status === "failed") {
      setError(job.error || "Gagal memuat drive perangkat.");
      setRootDiscoveryJobId(null);
    }
  }, [rootDiscoveryJobId, fileJobs]);

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
    const { data, error: invokeError } = await legacyDataClient.functions.invoke("admin-ops", {
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
        const { error: signInError } = await legacyDataClient.auth.signInWithPassword({
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
      const globalResult = await legacyDataClient.auth.signOut({ scope: "global" });
      if (globalResult.error) {
        await legacyDataClient.auth.signOut({ scope: "local" });
      }
    } catch (_error) {
      await legacyDataClient.auth.signOut({ scope: "local" }).catch(() => {});
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
    const updateVersion = selectedDevice && selectedDevice.deviceId === deviceId
      ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion
      : "";
    const commandCopy = getCommandCopy(action, serviceName, updateVersion);
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
      if (["start", "stop", "agent_start", "agent_stop", "agent_restart"].includes(action)) {
        setPendingCommandStates((current) => [
          ...current.filter(
            (item) => !(item.deviceId === deviceId && item.serviceName === serviceName && item.action === action)
          ),
          {
            id: `${deviceId}:${serviceName || "agent"}:${action}`,
            deviceId,
            serviceName,
            action,
            scope: serviceName ? "service" : "agent",
            targetStatus: getCommandProgressTarget(action),
            successMessage: commandCopy.success,
          },
        ]);
      }
      setDashboardInfo(commandCopy.pending);
      pushToast("Perintah dikirim", commandCopy.pending, "info");
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
      pushToast("Perintah gagal", message, "error");
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
      setDashboardInfo("Tautan guest berhasil disalin.");
      pushToast("Tautan disalin", "Tautan guest perangkat sudah masuk ke clipboard.", "success");
      loadAll(true);
    } catch (copyError) {
      setError(formatEdgeFunctionError(copyError));
      pushToast("Gagal menyalin tautan", formatEdgeFunctionError(copyError), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAccountAction(action, payload = {}) {
    try {
      setBusyAction(`account:${action}`);
      await invokeAdmin(action, payload);
      await loadAll(true);
      if (action === "updateAuthPolicy") {
        setDashboardInfo("Aturan policy berhasil disimpan.");
        pushToast("Policy tersimpan", "Label jam dan menit sudah mengikuti aturan terbaru.", "success");
      }
    } catch (accountError) {
      setError(formatEdgeFunctionError(accountError));
      pushToast("Aksi akun gagal", formatEdgeFunctionError(accountError), "error");
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
      syncGlobalDeviceSelection(deviceId);
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
      pushToast("Storage diperbarui", "Daftar pustaka berkas sudah disegarkan dari Supabase.", "success");
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
      pushToast("Storage gagal dimuat", formatEdgeFunctionError(artifactError), "error");
    } finally {
      setBusyAction("");
    }
  }

  function requestDeleteStorageArtifact(artifact) {
    setDeleteArtifactTarget(artifact || null);
  }

  async function deleteStorageArtifact() {
    const artifact = deleteArtifactTarget;
    if (!artifact) {
      return;
    }

    const fileName = artifact?.fileName || artifact?.objectKey || "berkas";

    try {
      setBusyAction(`artifact-delete:${artifact.id || artifact.objectKey}`);
      await invokeAdmin("deleteStorageArtifact", {
        bucket: artifact.bucket,
        objectKey: artifact.objectKey,
        jobId: artifact.jobId,
        deviceId: artifact.deviceId,
        fileName,
        isFolder: Boolean(artifact.isFolder),
      });
      setStorageArtifacts((current) =>
        current.filter((entry) => (entry.id || `${entry.bucket}:${entry.objectKey}`) !== (artifact.id || `${artifact.bucket}:${artifact.objectKey}`))
      );
      setDeleteArtifactTarget(null);
      await refreshStorageArtifacts();
      await loadAll(true);
      setDashboardInfo(
        artifact.isFolder
          ? `Folder ${fileName} berhasil dihapus dari storage.`
          : `Berkas ${fileName} berhasil dihapus dari storage.`
      );
      pushToast(
        artifact.isFolder ? "Folder dihapus" : "Berkas dihapus",
        artifact.isFolder
          ? "Seluruh isi folder terkait juga dihapus dari Supabase storage."
          : "Artefak berhasil dihapus dari Supabase storage.",
        "success"
      );
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
      pushToast("Gagal menghapus storage", formatEdgeFunctionError(artifactError), "error");
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
    setFilesView("remote");
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
    setFilesView("remote");
    const job = await createFileJob("discover_roots");
    if (job) {
      setRootDiscoveryJobId(job.id);
    }
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
        const { data, error: signError } = await legacyDataClient.storage
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
      const { error: uploadError } = await legacyDataClient.storage
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
    return <PageSkeleton title="Memuat profil akun" />;
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
  const filteredFleetDevices = deviceEntries.filter((device) => matchesDeviceQuery(device, fleetSearch));
  const fleetPageSize = 10;
  const totalFleetPages = Math.max(1, Math.ceil(filteredFleetDevices.length / fleetPageSize));
  const safeFleetPage = Math.min(Math.max(1, fleetPage), totalFleetPages);
  const pagedFleetDevices = filteredFleetDevices.slice(
    (safeFleetPage - 1) * fleetPageSize,
    safeFleetPage * fleetPageSize
  );
  const updateAvailableCount = deviceEntries.filter((device) => getDeviceUpdateModel(device.deviceRecord).updateAvailable).length;
  const deviceWarningCount = deviceEntries.reduce((total, device) => total + (device.issueCount > 0 || device.deviceStatus === "offline" ? 1 : 0), 0);
  const latestErrorLogs = logs.filter((log) => ["error", "warn"].includes(log.level)).slice(0, 3);
  const notificationItems = [
    ...(pendingAccountCount
      ? [{
          id: "pending-accounts",
          icon: Users,
          tone: "warn",
          title: `${pendingAccountCount} akun menunggu`,
          description: "Akun baru menunggu approval SuperAdmin.",
        }]
      : []),
    ...(deviceWarningCount
      ? [{
          id: "device-warning",
          icon: AlertTriangle,
          tone: "warn",
          title: `${deviceWarningCount} perangkat perlu dicek`,
          description: "Ada perangkat offline atau service yang perlu perhatian.",
        }]
      : []),
    ...(updateAvailableCount
      ? [{
          id: "updates",
          icon: Rocket,
          tone: "info",
          title: `${updateAvailableCount} update tersedia`,
          description: "Agent memiliki versi GitHub terbaru yang bisa dipasang.",
        }]
      : []),
    ...(activeRunningJobs
      ? [{
          id: "file-jobs",
          icon: FileText,
          tone: "info",
          title: `${activeRunningJobs} proses berkas berjalan`,
          description: "Transfer atau pekerjaan file sedang diproses.",
        }]
      : []),
    ...latestErrorLogs.map((log) => ({
      id: `log-${log.id}`,
      icon: AlertTriangle,
      tone: statusTone(log.level),
      title: log.level === "error" ? "Error terbaru" : "Peringatan terbaru",
      description: String(log.message || "").slice(0, 120),
    })),
  ];

  function openDeviceRoute(deviceId) {
    syncGlobalDeviceSelection(deviceId);
    navigateRoute("devices", { deviceId });
  }

  function renderFreshMetric(label, value, helper, Icon = Gauge, tone = "") {
    return (
      <article className={`fresh-metric ${tone ? `tone-${tone}` : ""}`}>
        <span className="fresh-metric-icon" aria-hidden="true">
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div>
          <span>{label}</span>
          <strong>{value}</strong>
          {helper ? <small>{helper}</small> : null}
        </div>
      </article>
    );
  }

  function renderFreshDeviceList(limit = 0) {
    const source = limit ? deviceEntries.slice(0, limit) : deviceEntries;
    if (!source.length) {
      return <EmptyState title="Belum ada perangkat" description="Perangkat akan muncul setelah agent mengirim heartbeat." />;
    }

    return (
      <div className="fresh-device-list">
        {source.map((device) => {
          const badge = getDeviceStatusBadgeModel(device.deviceStatus);
          const update = getDeviceUpdateModel(device.deviceRecord);
          return (
            <button
              key={device.deviceId}
              type="button"
              className={`fresh-device-row ${selectedDevice?.deviceId === device.deviceId ? "is-active" : ""}`}
              onClick={() => openDeviceRoute(device.deviceId)}
            >
              <span className="fresh-device-main">
                <strong>{device.deviceName}</strong>
                <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={26} />
              </span>
              <span className="fresh-device-meta">
                <StatusChip status={badge.status} label={badge.label} />
                {update.updateAvailable ? <StatusChip status="available" label="update" /> : null}
                <small>{device.runningCount} layanan aktif</small>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderFreshServiceList() {
    if (!selectedDevice) {
      return <EmptyState title="Pilih perangkat" description="Pilih perangkat untuk melihat layanan dan tautan E-Rapor." />;
    }

    if (!visibleServices.length) {
      return <EmptyState title="Belum ada layanan" description="Agent belum melaporkan layanan untuk perangkat ini." />;
    }

    return (
      <div className="fresh-service-list">
        {visibleServices.map((service) => {
          const serviceLabel = formatServiceDisplayName(service.service_name);
          const runtimeBadge = getServiceStatusBadgeModel(service.serviceStatus);
          const publicBadge = getPublicLinkBadgeModel(service);
          const runningNow = service.serviceStatus === "running" && service.desired_state !== "stopped";
          return (
            <article
              key={service.id}
              className={`fresh-service-card tone-${statusTone(service.serviceStatus)} service-${service.service_name}`}
            >
              <div className="fresh-card-head">
                <div>
                  <span className="section-eyebrow">Service</span>
                  <strong>{serviceLabel}</strong>
                  <small className="mono">localhost:{service.port}</small>
                </div>
                <div className="fresh-pill-group">
                  <StatusChip status={runtimeBadge.status} label={runtimeBadge.label} />
                  <StatusChip status={publicBadge.status} label={publicBadge.label} />
                </div>
              </div>
              <div className="fresh-data-grid">
                <div>
                  <span>{getPublicUrlLabel(service)}</span>
                  <strong>
                    {service.public_url ? (
                      <LongText value={service.public_url} href={service.public_url} label={`Tautan ${serviceLabel}`} maxLength={44} />
                    ) : (
                      "Belum tersedia"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Lokasi aplikasi</span>
                  <strong>
                    <LongText value={service.resolved_path || ""} label="Lokasi aplikasi" className="mono" maxLength={42} />
                  </strong>
                </div>
                <div>
                  <span>Update status</span>
                  <strong>{formatRelativeTime(service.last_ping, now)}</strong>
                </div>
              </div>
              {service.location_details?.message ? (
                <div className="fresh-inline-note">
                  <LongText value={service.location_details.message} label="Detail lokasi" maxLength={76} />
                </div>
              ) : null}
              {service.last_error ? (
                <div className="fresh-inline-error">
                  <LongText value={service.last_error} label="Error layanan" maxLength={76} />
                </div>
              ) : null}
              <div className="fresh-actions">
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
                  <PublicLinkActions
                    url={service.public_url || ""}
                    label={`Tautan ${serviceLabel} untuk ${selectedDevice.deviceName}`}
                    compact
                    onActionComplete={setError}
                    onFeedback={handleInlineFeedback}
                  />
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  function renderFreshDeviceDetail(options = {}) {
    if (!selectedDevice) {
      return <EmptyState title="Belum ada perangkat aktif" description="Dashboard akan terisi setelah perangkat tersedia." />;
    }

    return (
      <section className="fresh-section-stack">
        {selectedTab === "devices" && !options.compact ? (
          <>
            <DeviceCombobox
              devices={deviceEntries}
              selectedDeviceId={selectedDevice.deviceId}
              onSelect={(deviceId) => openDeviceRoute(deviceId)}
              label="Pilih perangkat"
              className="page-device-combobox"
            />
            <DeviceWarningPanel device={selectedDevice} />
          </>
        ) : null}
        <article className="fresh-hero-card">
          <div>
            <span className="section-eyebrow">Perangkat terpilih</span>
            <h2>{selectedDevice.deviceName}</h2>
            <LongText value={selectedDevice.deviceId} label="ID perangkat" className="mono" maxLength={34} />
            {selectedDevice.deviceAlias ? <small>Nama asli: {selectedDevice.rawDeviceName}</small> : null}
          </div>
          <div className="fresh-actions device-hero-actions">
            <StatusChip status={selectedDeviceBadge.status} label={selectedDeviceBadge.label} />
            <ActionButton className="secondary-button" onClick={() => openAliasModal(selectedDevice)}>Edit alias</ActionButton>
          </div>
        </article>
        <section className="fresh-metric-grid">
          {renderFreshMetric("Terakhir tersambung", formatRelativeTime(selectedDevice.deviceRecord?.last_seen, now), "Heartbeat agent terbaru", Activity)}
          {renderFreshMetric("Layanan aktif", selectedDevice.runningCount, "Service yang sedang berjalan", Server, "good")}
          {renderFreshMetric("Proses berkas", selectedDevice.fileJobCount, "Job file aktif", FileText)}
          {renderFreshMetric("Perlu perhatian", selectedDevice.issueCount, "Error/offline/missing", AlertTriangle, selectedDevice.issueCount ? "warn" : "")}
          <DeviceUpdateCard
            deviceRecord={selectedDevice.deviceRecord}
            deviceStatus={selectedDevice.deviceStatus}
            busy={busyAction === `${selectedDevice.deviceId}:device:update`}
            onUpdate={() => queueCommand(selectedDevice.deviceId, null, "update")}
            showAction
          />
        </section>
        <article className="fresh-panel">
          <SectionHeader
            eyebrow="Akses"
            title="Tautan E-Rapor"
            description="Tautan utama disingkat di layar dan detail lengkap tetap tersedia lewat overlay."
            actions={<PublicLinkActions url={selectedGuestUrl} label={`Tautan akses untuk ${selectedDevice.deviceName}`} compact onActionComplete={setError} onFeedback={handleInlineFeedback} />}
          />
          <div className="fresh-link-bar">
            <LongText value={selectedGuestUrl} href={selectedGuestUrl} label="Tautan akses" className="mono" maxLength={70} />
          </div>
        </article>
        {(isSuperAdmin || isOperator) ? (
          <article className="fresh-panel">
            <SectionHeader
              eyebrow="Agent"
              title="Kontrol agent"
              description="Kontrol ini memengaruhi agent perangkat secara penuh. Stop agent akan menghentikan layanan yang dikelola, tetapi heartbeat online perangkat tetap dijaga."
            />
            <div className="fresh-actions agent-command-actions">
              <ActionButton
                className="primary-button"
                icon={Play}
                busy={busyAction === `${selectedDevice.deviceId}:device:agent_start`}
                disabled={busyAction !== ""}
                onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_start")}
              >
                Start Agent
              </ActionButton>
              <ActionButton
                className="secondary-button"
                icon={Square}
                busy={busyAction === `${selectedDevice.deviceId}:device:agent_stop`}
                disabled={busyAction !== ""}
                onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_stop")}
              >
                Stop Agent
              </ActionButton>
              <ActionButton
                className="secondary-button"
                icon={RotateCcw}
                busy={busyAction === `${selectedDevice.deviceId}:device:agent_restart`}
                disabled={busyAction !== ""}
                onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_restart")}
              >
                Restart Agent
              </ActionButton>
            </div>
          </article>
        ) : null}
        <article className="fresh-panel">
          <SectionHeader eyebrow="Services" title="Kontrol layanan" description="Tombol pada tiap kartu hanya memengaruhi layanan tersebut, bukan seluruh perangkat." />
          {renderFreshServiceList()}
        </article>
      </section>
    );
  }

  function renderFreshOverview() {
    const onlineDevices = deviceEntries.filter((device) => device.deviceStatus !== "offline").length;
    const runningServices = deviceEntries.reduce((total, device) => total + device.runningCount, 0);
    return (
      <section className="fresh-section-stack">
        <section className="fresh-metric-grid">
          {renderFreshMetric("Perangkat aktif", `${onlineDevices}/${deviceEntries.length}`, "Status koneksi agent", Monitor, "good")}
          {renderFreshMetric("Layanan berjalan", runningServices, "Service siap dipakai", Server)}
          {renderFreshMetric("Akun pending", pendingAccountCount, "Menunggu approval", Users, pendingAccountCount ? "warn" : "")}
          {renderFreshMetric("Job berkas", activeRunningJobs, "Transfer berjalan", FileText)}
        </section>
        <article className="fresh-panel fleet-strip-panel">
          <SectionHeader
            eyebrow="Fleet"
            title="Perangkat"
            description="Tampilkan 10 perangkat per halaman dengan pencarian nama, alias, atau device id."
            actions={
              <label className="fleet-search-field">
                <Search size={16} aria-hidden="true" />
                <input value={fleetSearch} onChange={(event) => setFleetSearch(event.target.value)} placeholder="Server TU atau device id" />
              </label>
            }
          />
          <div className="fleet-strip" aria-label="Daftar perangkat">
            {pagedFleetDevices.length ? pagedFleetDevices.map((device) => {
              const badge = getDeviceStatusBadgeModel(device.deviceStatus);
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  className={`fleet-strip-card ${selectedDevice?.deviceId === device.deviceId ? "is-active" : ""}`}
                  onClick={() => syncGlobalDeviceSelection(device.deviceId)}
                >
                  <strong>{device.deviceName}</strong>
                  <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={24} />
                  <div className="fresh-pill-group">
                    <StatusChip status={badge.status} label={badge.label} />
                    <span>{device.runningCount} service</span>
                  </div>
                </button>
              );
            }) : <EmptyState title="Device tidak ditemukan" description="Ubah kata kunci pencarian fleet." />}
          </div>
          {filteredFleetDevices.length > fleetPageSize ? (
            <Pagination
              page={safeFleetPage}
              totalItems={filteredFleetDevices.length}
              pageSize={fleetPageSize}
              onPageChange={setFleetPage}
            />
          ) : null}
        </article>
        <article className="fresh-panel">
          <SectionHeader eyebrow="Detail cepat" title={selectedDevice?.deviceName || "Belum ada perangkat"} description="Ringkasan perangkat terpilih." />
          {renderFreshDeviceDetail({ compact: true })}
        </article>
      </section>
    );
  }

  function renderFreshFiles() {
    if (!isSuperAdmin) {
      return <EmptyState title="Tidak tersedia" description="Berkas hanya tersedia untuk SuperAdmin." />;
    }

    const filteredRoots = selectedDeviceRoots
      .map((root) => {
        const match = getRemoteRootPreference(root);
        return match ? { ...root, label: match.label, _priority: match.score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left._priority - right._priority);
    const activeExplorerJob =
      (directoryJobId ? fileJobs.find((entry) => entry.id === directoryJobId) : null) ||
      (rootDiscoveryJobId ? fileJobs.find((entry) => entry.id === rootDiscoveryJobId) : null) ||
      null;
    const explorerLoadingProgress = activeExplorerJob
      ? {
          percent: Math.min(
            100,
            Math.max(
              8,
              Math.round(
                (Number(activeExplorerJob.progress_current || 0) /
                  Math.max(1, Number(activeExplorerJob.progress_total || 1))) *
                  100
              )
            )
          ),
          label:
            activeExplorerJob.job_type === "discover_roots"
              ? "Memindai drive dan lokasi perangkat"
              : "Membaca isi folder perangkat",
        }
      : null;

    const refreshCurrentPath = () => {
      if (currentPath) {
        openPath(currentPath);
        return;
      }
      refreshRoots();
    };

    return (
      <section className="fresh-section-stack">
        <article className="fresh-panel files-view-panel">
          <SectionHeader eyebrow="Berkas" title="Sumber berkas" description="Pisahkan storage arsip dan remote file agar halaman tetap fokus." />
          <div className="subpage-tabs" role="tablist" aria-label="Sub halaman berkas">
            <button
              type="button"
              className={`tab-button ${filesView === "storage" ? "is-active" : ""}`}
              aria-selected={filesView === "storage"}
              onClick={() => setFilesView("storage")}
            >
              Storage
            </button>
            <button
              type="button"
              className={`tab-button ${filesView === "remote" ? "is-active" : ""}`}
              aria-selected={filesView === "remote"}
              onClick={() => setFilesView("remote")}
            >
              Remote File
            </button>
          </div>
        </article>
        {filesView === "storage" ? (
          <>
            <article className="fresh-panel file-library-filter-panel">
              <SectionHeader
                eyebrow="Storage"
                title="Pustaka berkas"
                description="Daftar arsip utama dibatasi 10 item per halaman."
                actions={<ActionButton className="secondary-button" busy={busyAction === "artifacts:refresh"} icon={RefreshCw} onClick={refreshStorageArtifacts}>Segarkan storage</ActionButton>}
              />
              <div className="artifact-filter-bar file-library-filters">
                <label>
                  <span>Bucket</span>
                  <select value={artifactBucketFilter} onChange={(event) => setArtifactBucketFilter(event.target.value)}>
                    <option value="all">Semua bucket</option>
                    <option value="agent-temp-artifacts">Berkas sementara</option>
                    <option value="agent-archives">Arsip permanen</option>
                    <option value="agent-preview-cache">Cache pratinjau</option>
                    <option value="admin-upload-staging">Unggahan admin</option>
                  </select>
                </label>
                <label>
                  <span>Device</span>
                  <select value={artifactDeviceFilter} onChange={(event) => syncGlobalDeviceSelection(event.target.value)}>
                    <option value="all">Semua device</option>
                    {artifactDeviceOptions.map((device) => (
                      <option key={device.id} value={device.id}>{device.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cari</span>
                  <input value={artifactSearch} onChange={(event) => setArtifactSearch(event.target.value)} placeholder="rapor-2026.zip" />
                </label>
              </div>
            </article>
            <SupabaseFileTable
              artifacts={visibleStorageArtifacts}
              page={filePage}
              onPageChange={setFilePage}
              busyAction={busyAction}
              onDownload={handleArtifactDownload}
              onDelete={requestDeleteStorageArtifact}
            />
          </>
        ) : (
          <article className="fresh-panel">
            <SectionHeader
              eyebrow="Remote file"
              title="Akses berkas perangkat"
              description="Pilih perangkat, buka This PC, lalu unggah atau unduh file yang dipilih."
              actions={
                <>
                  <ActionButton className="secondary-button" onClick={() => setLogOverlayOpen(true)}>Log</ActionButton>
                  <ActionButton className="secondary-button" onClick={refreshCurrentPath}>Refresh list</ActionButton>
                </>
              }
            />
            <DeviceCombobox
              devices={deviceEntries}
              selectedDeviceId={selectedDevice?.deviceId || ""}
              onSelect={syncGlobalDeviceSelection}
              label="Pilih perangkat"
              className="page-device-combobox"
            />
            <input ref={fileInputRef} type="file" hidden onChange={(event) => triggerUpload(event.target.files?.[0])} />
            <div className="fresh-link-bar">
              <LongText value={currentPath || "This PC"} label="Path aktif" className="mono" maxLength={80} empty="This PC" />
            </div>
            <div className="fresh-file-list-shell">
              <div className="floating-selection-actions remote-file-actions is-visible">
                <div className="remote-file-actions-copy">
                  <strong>{selectedPaths.length ? `${selectedPaths.length} item dipilih` : "Belum ada file dipilih"}</strong>
                  <small>Unggah ke folder aktif atau unduh file yang sudah dipilih.</small>
                </div>
                <ActionButton className="secondary-button" disabled={!currentPath} onClick={() => fileInputRef.current?.click()}>
                  Unggah ke folder ini
                </ActionButton>
                <ActionButton className="primary-button" disabled={!selectedPaths.length} onClick={queueDownloadSelection}>
                  {selectedPaths.length ? `Unduh pilihan (${selectedPaths.length})` : "Unduh pilihan"}
                </ActionButton>
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
                loading={fileExplorerBusy}
                loadingLabel={explorerLoadingProgress?.label || ""}
                loadingProgress={explorerLoadingProgress}
                virtualRootLabel={directoryResult?.virtualRootLabel || ""}
              />
            </div>
          </article>
        )}
        {filesView === "remote" ? (
          <FloatingFileActivity
            jobs={selectedDeviceJobs}
            open={fileActivityOpen}
            expanded={fileActivityExpanded}
            onToggleOpen={() => setFileActivityOpen((current) => !current)}
            onToggleExpanded={() => setFileActivityExpanded((current) => !current)}
            onDownload={handleArtifactDownload}
          />
        ) : null}
        <LogOverlay open={logOverlayOpen} logs={logs} jobs={fileJobs} deviceId={selectedDevice?.deviceId || "all"} onClose={() => setLogOverlayOpen(false)} />
      </section>
    );
  }

  function renderFreshActivity() {
    const effectiveActivityDeviceId = activityDeviceId || selectedDevice?.deviceId || "all";
    const visibleLogs = logs
      .filter((log) => logLevelFilter === "all" || log.level === logLevelFilter)
      .filter((log) => effectiveActivityDeviceId === "all" || log.device_id === effectiveActivityDeviceId)
      .filter((log) => !isUser || !log.service_name || log.service_name === "rapor");
    return (
      <section className="fresh-section-stack">
        <article className="fresh-panel">
          <SectionHeader
            eyebrow="Activity"
            title="Aktivitas terbaru"
            description="Detail JSON panjang dibuka lewat overlay agar daftar tetap bersih."
            actions={
              <select value={logLevelFilter} onChange={(event) => setLogLevelFilter(event.target.value)}>
                <option value="all">Semua</option>
                <option value="error">Perlu dicek</option>
                <option value="warn">Peringatan</option>
                <option value="info">Informasi</option>
              </select>
            }
          />
          <DeviceCombobox
            devices={deviceEntries}
            selectedDeviceId={effectiveActivityDeviceId}
            onSelect={syncGlobalDeviceSelection}
            includeAll
            allLabel="Semua device"
            label="Filter device"
            className="page-device-combobox"
          />
          <div className="fresh-timeline">
            {visibleLogs.length ? visibleLogs.map((log) => (
              <article key={log.id} className={`fresh-timeline-row tone-${statusTone(log.level)}`}>
                <span className="fresh-timeline-dot" />
                <div>
                  <strong><LongText value={log.message} label="Pesan log" maxLength={84} /></strong>
                  <small className="mono">
                    {formatDate(log.created_at)} |{" "}
                    <LongText value={`${log.device_id} | ${log.service_name || "system"}`} label="Sumber log" maxLength={48} />
                  </small>
                  {log.details ? <LongText value={JSON.stringify(log.details, null, 2)} label="Detail log" className="mono" maxLength={90} /> : null}
                </div>
                <StatusChip status={log.level} />
              </article>
            )) : <EmptyState title="Belum ada aktivitas" description="Aktivitas realtime akan muncul di sini." />}
          </div>
        </article>
      </section>
    );
  }

  function renderFreshAccounts() {
    if (!(isSuperAdmin || isOperator)) {
      return <EmptyState title="Tidak tersedia" description="Manajemen akun hanya untuk Operator dan SuperAdmin." />;
    }

    return (
      <section className="fresh-section-stack">
        {isSuperAdmin ? (
          <article className="fresh-panel">
            <SectionHeader eyebrow="Policy" title="Aturan persetujuan" description="Nilai angka memakai field khusus dan URL reset dinormalisasi ke HTTPS." />
            <div className="fresh-form-grid">
              <MaskedTextField label="Persetujuan Operator (jam)" mask="number" inputMode="numeric" value={authPolicy.operatorAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, operatorAutoApproveHours: Number(value || 24) }))} />
              <MaskedTextField label="Pengguna lingkungan (jam)" mask="number" inputMode="numeric" value={authPolicy.environmentUserAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, environmentUserAutoApproveHours: Number(value || 8) }))} />
              <label>
                <span>Pengguna mandiri</span>
                <select value={authPolicy.standaloneUserApprovalMode} onChange={(event) => setAuthPolicy((current) => ({ ...current, standaloneUserApprovalMode: event.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="auto">Otomatis</option>
                </select>
              </label>
              <MaskedTextField label="Waktu persetujuan mandiri (jam)" mask="number" inputMode="numeric" value={authPolicy.standaloneUserAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, standaloneUserAutoApproveHours: Number(value || 24) }))} />
              <MaskedTextField label="Interval pemeriksaan (menit)" mask="number" inputMode="numeric" value={authPolicy.maintenanceIntervalMinutes} onChange={(value) => setAuthPolicy((current) => ({ ...current, maintenanceIntervalMinutes: Number(value || 15) }))} />
              <MaskedTextField label="Halaman reset password" mask="url" value={authPolicy.passwordResetRedirectUrl} onChange={(value) => setAuthPolicy((current) => ({ ...current, passwordResetRedirectUrl: value }))} placeholder="https://example.com/auth/reset-password" />
              <ActionButton className="primary-button" busy={busyAction === "account:updateAuthPolicy"} onClick={() => handleAccountAction("updateAuthPolicy", authPolicy)}>Simpan aturan</ActionButton>
            </div>
          </article>
        ) : null}
        <article className="fresh-panel">
          <SectionHeader eyebrow="Create" title="Buat akun" description="Akun baru langsung masuk daftar dengan status yang dipilih." />
          <div className="fresh-form-grid">
            <MaskedTextField label="Email" type="email" mask="email" value={createEmail} onChange={setCreateEmail} placeholder="Example@gmail.com" inputMode="email" />
            <MaskedTextField label="Nama" value={createDisplayName} onChange={setCreateDisplayName} placeholder="Budi Santoso" mask="alias" maxLength={80} />
            <PasswordField label="Password" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} placeholder="********" autoComplete="new-password" />
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
                <select value={createAssignedDeviceId} onChange={(event) => setCreateAssignedDeviceId(event.target.value)} disabled={!deviceEntries.length}>
                  <option value="">{deviceEntries.length ? "Pilih perangkat" : "Belum ada perangkat tersedia"}</option>
                  {deviceEntries.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.deviceName} ({device.deviceId})</option>
                  ))}
                </select>
              </label>
            ) : null}
            <ActionButton className="primary-button" busy={busyAction === "account:createAccount"} onClick={createManagedAccount}>Buat akun</ActionButton>
          </div>
        </article>
        <article className="fresh-panel">
          <SectionHeader eyebrow="Accounts" title="Daftar akun" description="Daftar akun ditampilkan sebagai tabel terstruktur dengan pagination." />
          <AccountTable
            accounts={accounts}
            page={accountPage}
            onPageChange={setAccountPage}
            busyAction={busyAction}
            onAction={handleAccountAction}
            onDelete={handleDeleteAccount}
            isSuperAdmin={isSuperAdmin}
          />
        </article>
      </section>
    );
  }

  function renderFreshScene() {
    let scene = renderFreshOverview();
    if (selectedTab === "devices") {
      scene = renderFreshDeviceDetail();
    } else if (selectedTab === "files") {
      scene = renderFreshFiles();
    } else if (selectedTab === "activity") {
      scene = renderFreshActivity();
    } else if (selectedTab === "accounts") {
      scene = renderFreshAccounts();
    } else if (selectedTab === "profile") {
      scene = <ProfilePanel profile={profile} session={session} onSignOut={signOut} />;
    }
    return (
      <section className="fresh-console-stage">
        {scene}
      </section>
    );
  }

  return (
    <main className={`console-shell app-shell-page role-${profile.role} route-${selectedTab} ${deviceScopedOffline ? "is-device-offline" : ""} ${commandExecutionActive ? "is-command-locked" : ""}`.trim()}>
      <div className={`app-shell ${sidebarPinned ? "sidebar-is-pinned" : ""}`}>
        <SidebarNav
          profile={profile}
          activeSection={selectedTab}
          items={dashboardNavItems}
          onNavigate={navigateRoute}
          pinned={sidebarPinned}
          onTogglePinned={() => setSidebarPinned((current) => !current)}
          onExpandedChange={setSidebarExpanded}
        />
        <section className="app-content">
          <TopCommandBar
            profile={profile}
            loading={loading}
            authBusy={authBusy}
            onRefresh={() => loadAll()}
            onSignOut={signOut}
            notifications={notificationItems}
            notificationOpen={notificationOpen}
            onNotificationToggle={() => setNotificationOpen((current) => !current)}
            onNotificationClose={() => setNotificationOpen(false)}
          />
          <RouteHeader
            route={appRoute}
            profile={profile}
            breadcrumbs={routeBreadcrumbs}
          />
          <PriorityBanner
            route={appRoute}
            profile={profile}
            devices={deviceEntries}
            fileJobs={fileJobs}
            accounts={accounts}
          />
          <MobileNav activeSection={selectedTab} items={dashboardNavItems} onNavigate={navigateRoute} />

      {error ? <div className="error-banner">{error}</div> : null}
      {dashboardInfo ? <div className="service-note">{dashboardInfo}</div> : null}
      {showGuestLinkPrompt ? (
        <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-link-title" onMouseDown={(event) => dismissOnBackdrop(event, dismissGuestDeviceLink)}>
          <div className="guest-modal-card">
            <strong id="guest-link-title">Tautkan perangkat ini ke akun Anda?</strong>
            <p>
              Perangkat{" "}
              <LongText value={pendingGuestLinkDeviceId} label="ID perangkat" className="mono" maxLength={28} />{" "}
              akan ditambahkan ke akses akun ini.
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
      <ConfirmDialog
        open={Boolean(deleteArtifactTarget)}
        title="Hapus berkas storage?"
        message={
          deleteArtifactTarget
            ? `${
                deleteArtifactTarget.isFolder ? "Folder" : "Berkas"
              } "${deleteArtifactTarget.fileName || safeFileNameFromKey(deleteArtifactTarget.objectKey)}" akan dihapus dari storage cloud dan dihilangkan dari pustaka berkas.`
            : ""
        }
        confirmLabel={deleteArtifactTarget?.isFolder ? "Hapus folder" : "Hapus berkas"}
        cancelLabel="Batal"
        destructive
        busy={busyAction === `artifact-delete:${deleteArtifactTarget?.id || deleteArtifactTarget?.objectKey || ""}`}
        onConfirm={deleteStorageArtifact}
        onClose={() => setDeleteArtifactTarget(null)}
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
      <CommandProgressOverlay
        open={commandExecutionActive}
        title="Perintah sedang diproses"
        message={commandProgressMessage}
        percent={commandExecutionProgress}
      />
      <ToastViewport items={toastItems} onDismiss={dismissToast} />

      {renderFreshScene()}
        </section>
      </div>
    </main>
  );
}

