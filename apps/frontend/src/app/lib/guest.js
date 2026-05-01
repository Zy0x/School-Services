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

export function buildWhatsAppShareUrl(url, label = "Tautan akses") {
  const text = `${label}\n${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function getGuestStatusModel(device, service) {
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
      description: "Perangkat sedang disiapkan. Tunggu beberapa saat, lalu segarkan halaman ini.",
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
