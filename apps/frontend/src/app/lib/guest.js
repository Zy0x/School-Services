import { formatServiceDisplayName } from "./status.js";

export function formatCommandTargetLabel(serviceName) {
  if (!serviceName) {
    return "agent";
  }
  const name = formatServiceDisplayName(serviceName);
  return `layanan ${name}`;
}

export function getCommandCopy(action, serviceName, versionLabel = "") {
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

export function getCommandProgressTarget(action) {
  if (action === "stop" || action === "agent_stop") {
    return "stopped";
  }
  return "running";
}

const DEFAULT_ACCESS_SERVER_NAME = "E-Rapor";
const COMMAND_PROGRESS_AUTO_SHOW_MS = 15 * 60 * 1000;

function normalizeShareText(value, fallback = "") {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function formatWhatsAppBold(value) {
  return `*${normalizeShareText(value).replace(/\*/g, "")}*`;
}

export function buildNgrokVisitSiteNotice(serverName = DEFAULT_ACCESS_SERVER_NAME) {
  const accessName = normalizeShareText(serverName, DEFAULT_ACCESS_SERVER_NAME);
  return `Catatan Ngrok: jika muncul halaman "You are about to visit", tekan tombol Visit Site sekali untuk membuka ${accessName}.`;
}

export function buildNgrokWhatsAppNotice(serverName = DEFAULT_ACCESS_SERVER_NAME) {
  const accessName = normalizeShareText(serverName, DEFAULT_ACCESS_SERVER_NAME);
  return `*Catatan:* Jika muncul halaman "You are about to visit", tekan *Visit Site* untuk masuk ke ${accessName}.`;
}

export function isNgrokFreeTunnelUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "ngrok-free.app" || hostname.endsWith(".ngrok-free.app");
  } catch {
    return false;
  }
}

export function isNgrokFreeProxyUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").includes("ngrok-proxy");
  } catch {
    return false;
  }
}

export function shouldShowNgrokVisitSiteNotice(url, tunnelProvider) {
  return (
    String(tunnelProvider || "").trim().toLowerCase() === "ngrok" &&
    (isNgrokFreeTunnelUrl(url) || isNgrokFreeProxyUrl(url))
  );
}

export function isCommandInProgress(command) {
  return ["pending", "running"].includes(String(command?.status || "").toLowerCase());
}

export function isRecentCommandProgress(command, nowMs = Date.now()) {
  const timestamp = new Date(command?.updated_at || command?.updatedAt || command?.created_at || command?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 && nowMs - timestamp <= COMMAND_PROGRESS_AUTO_SHOW_MS;
}

export function shouldAutoShowCommandProgress(command, deviceStatus = "") {
  if (!isCommandInProgress(command) || !isRecentCommandProgress(command)) {
    return false;
  }

  const commandStatus = String(command?.status || "").toLowerCase();
  const action = String(command?.action || "").toLowerCase();
  if (commandStatus === "running") {
    return true;
  }
  if (["agent_start", "agent_restart", "update"].includes(action)) {
    return true;
  }

  const normalizedDeviceStatus = String(deviceStatus || "").toLowerCase();
  return !["offline", "blocked", "pending_setup"].includes(normalizedDeviceStatus);
}

export function buildWhatsAppShareText(url, label = "Tautan akses", options = {}) {
  const serverName = normalizeShareText(options.serverName, DEFAULT_ACCESS_SERVER_NAME);
  const targetName = normalizeShareText(options.targetName);
  const shareLabel = targetName
    ? `Tautan akses ${serverName} untuk ${formatWhatsAppBold(targetName)}`
    : normalizeShareText(label, "Tautan akses");
  const lines = [shareLabel, url];
  const warningUrl = options.ngrokWarningUrl || url;
  if (shouldShowNgrokVisitSiteNotice(warningUrl, options.tunnelProvider)) {
    lines.push("", buildNgrokWhatsAppNotice(serverName));
  }
  return lines.join("\n");
}

export function buildWhatsAppShareUrl(url, label = "Tautan akses", options = {}) {
  const text = buildWhatsAppShareText(url, label, options);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function getGuestStatusModel(device, service) {
  const deviceStatus = device?.deviceStatus || "offline";
  const agentStatus = device?.agentStatus || (deviceStatus === "online" ? "running" : deviceStatus);
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
    agentStatus === "running" &&
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
      description: "Perangkat sedang disiapkan. Tunggu beberapa saat, lalu segarkan halaman ini.",
      publicStatus: "disabled",
      publicLabel: "Tautan belum tersedia",
      runtimeLabel: "Menunggu perangkat",
      runtimeChipLabel: "setup awal",
      ready: false,
    };
  }

  if (deviceStatus === "offline") {
    if (device?.agentControlReady) {
      return {
        overallStatus: "reconnecting",
        headline: "Agent tidak tersambung",
        description:
          "Perangkat masih online melalui supervisor. Gunakan Pulihkan Agent untuk memulai ulang agent dan membuka link baru.",
        publicStatus: hasPublicUrl ? "unavailable" : "disabled",
        publicLabel: hasPublicUrl ? "Tautan terakhir tersedia" : "Tautan belum tersedia",
        runtimeLabel: "Agent perlu dipulihkan",
        runtimeChipLabel: "agent offline",
        ready: false,
      };
    }
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

  if (agentStatus === "stopped" || agentStatus === "stopping") {
    return {
      overallStatus: "stopped",
      headline: "Agent School Services berhenti",
      description:
        "Perangkat masih tercatat, tetapi agent sedang berhenti sehingga status dan kontrol layanan tidak bisa diproses.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "Tautan terakhir tersedia" : "Tautan belum tersedia",
      runtimeLabel: "Agent berhenti",
      runtimeChipLabel: agentStatus === "stopping" ? "menghentikan agent" : "agent berhenti",
      ready: false,
    };
  }

  if (["starting", "restarting", "updating"].includes(agentStatus)) {
    return {
      overallStatus: "reconnecting",
      headline: agentStatus === "updating" ? "Agent sedang update" : "Agent sedang dipulihkan",
      description:
        "Agent sedang menyala kembali. Status layanan dan tautan publik akan aktif setelah heartbeat baru diterima.",
      publicStatus: "reconnecting",
      publicLabel: "Menunggu agent siap",
      runtimeLabel: "Agent dipulihkan",
      runtimeChipLabel: agentStatus === "updating" ? "update" : "menyala",
      ready: false,
    };
  }

  if (ready) {
    return {
      overallStatus: "ready",
      headline: "E-Rapor siap digunakan",
      description: "Perangkat tersambung dan layanan E-Rapor siap dibuka.",
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
      description: "Perangkat tersambung. Tekan Mulai untuk menyalakan E-Rapor.",
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
