export function isInvalidSessionError(error) {
  const message = String(error?.message || error || "");
  return /invalid admin session|missing authorization header|jwt|unauthorized/i.test(message);
}

export function isSamePasswordError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || error || "").trim().toLowerCase();
  return (
    code === "same_password" ||
    /same password|different password|password.*same|different from the one currently used/i.test(message)
  );
}

export function formatEdgeFunctionError(error) {
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

export function formatSignInError(error) {
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

export function formatPasswordUpdateError(error) {
  if (isInvalidSessionError(error)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  if (isSamePasswordError(error)) {
    return "Password baru tidak boleh sama dengan password yang lama.";
  }
  return String(error?.message || error || "Gagal memperbarui password.");
}

export function clearStoredAuthArtifacts() {
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
