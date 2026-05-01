import {
  AUTH_PATH,
  DASHBOARD_SECTIONS,
  PUBLIC_DASHBOARD_URL,
  RESET_PASSWORD_PATH,
} from "./constants.js";

export function normalizePathname(pathname = "") {
  const normalized = `/${String(pathname || "/").trim()}`.replace(/\/+/g, "/");
  return normalized.replace(/\/+$/, "") || "/";
}

export function buildPath(pathname = "/", params = {}) {
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

export function buildPublicUrl(pathname = "/", params = {}) {
  return `${PUBLIC_DASHBOARD_URL}${buildPath(pathname, params)}`;
}

export function parseAppRoute(pathname = "") {
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

export function buildRoutePath(section = "overview", params = {}) {
  const safeSection = DASHBOARD_SECTIONS.has(section) ? section : "overview";
  if (safeSection === "devices" && params.deviceId) {
    return `/dashboard/devices/${encodeURIComponent(params.deviceId)}`;
  }
  return `/dashboard/${safeSection}`;
}

export function getAllowedDashboardSections(role) {
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

export function getRouteCopy(section, role) {
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

export function buildGuestPath(deviceId) {
  return `/guest/${encodeURIComponent(String(deviceId || "").trim())}`;
}

export function buildGuestUrl(deviceId) {
  return buildPublicUrl(buildGuestPath(deviceId));
}

export function buildAuthPath(params = {}) {
  return buildPath(AUTH_PATH, params);
}

export function buildAuthUrl(params = {}) {
  return buildPublicUrl(AUTH_PATH, params);
}

export function buildResetPasswordUrl() {
  return buildPublicUrl(RESET_PASSWORD_PATH);
}
