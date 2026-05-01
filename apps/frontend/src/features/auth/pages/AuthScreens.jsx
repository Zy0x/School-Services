import { useEffect, useState } from "react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { buildAuthPath } from "../../../app/lib/routes.js";
import { clearStoredAuthArtifacts, formatPasswordUpdateError } from "../../../app/lib/errors.js";
import { formatRelativeTime } from "../../../app/lib/status.js";
import {
  ActionButton,
  MaskedTextField,
  PasswordField,
  StatusChip,
} from "../../../components/ui/core.jsx";

export function LoginScreen({
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
            <p>Buka layanan sekolah dan lihat status perangkat melalui halaman yang ringkas.</p>
          </div>
          <div className="auth-visual-list" aria-label="Fitur akses">
            <span>Akses mengikuti jenis akun Anda.</span>
            <span>Status layanan ditampilkan dengan jelas.</span>
          </div>
        </section>
        <section className="auth-form-panel">
          <div className="login-eyebrow">{mode === "register" ? "Daftar Akun" : "Selamat Datang"}</div>
          <h1>{mode === "register" ? "Ajukan akun" : "Masuk"}</h1>
          <p>Gunakan akun yang telah terdaftar untuk melanjutkan.</p>
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
              {loading ? (mode === "register" ? "Mengirim..." : "Masuk...") : mode === "register" ? "Ajukan akun" : "Masuk"}
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

export function AccountStatusScreen({ profile, onSignOut }) {
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

export function PasswordResetScreen() {
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
        const { error: exchangeError } = await legacyDataClient.auth.exchangeCodeForSession(code);
        recoveryError = exchangeError;
      } else if (accessToken && refreshToken) {
        const { error: sessionError } = await legacyDataClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        recoveryError = sessionError;
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
        window.history.replaceState({}, document.title, "/auth/reset-password");
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
      const { error: updateError } = await legacyDataClient.auth.updateUser({ password: passwordValue });
      if (updateError) {
        throw updateError;
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
    } catch (nextError) {
      setError(formatPasswordUpdateError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card auth-simple-card">
        <div className="login-eyebrow">Reset Password</div>
        <h1>Buat password baru</h1>
        <p>Masukkan password baru untuk melanjutkan akses akun Anda.</p>
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
