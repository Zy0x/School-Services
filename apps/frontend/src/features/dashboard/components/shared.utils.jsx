import { getRouteCopy } from "../../../app/lib/routes.js";

function dismissOnBackdrop(event, onClose) {
  if (event.target === event.currentTarget) {
    onClose?.();
  }
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

function normalizeLoginEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLoginPassword(value) {
  return String(value || "");
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

export {
  dismissOnBackdrop,
  getActivityLabel,
  getRemoteRootPreference,
  getRouteBreadcrumbs,
  normalizeLoginEmail,
  normalizeLoginPassword,
  truncateText
};
