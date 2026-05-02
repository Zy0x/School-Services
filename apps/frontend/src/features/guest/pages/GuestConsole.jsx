import { useEffect, useState } from "react";
import { Activity, CircleArrowUp, RefreshCw, Server } from "lucide-react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { REFRESH_INTERVAL_MS } from "../../../app/lib/constants.js";
import { formatEdgeFunctionError } from "../../../app/lib/errors.js";
import { buildAuthUrl } from "../../../app/lib/routes.js";
import {
  formatRelativeTime,
  formatServiceDisplayName,
  getServiceStatusBadgeModel,
  statusTone,
} from "../../../app/lib/status.js";
import { getGuestStatusModel } from "../../../app/lib/guest.js";
import { getDeviceUpdateModel } from "../../../app/lib/update.js";
import {
  ActionButton,
  CommandProgressOverlay,
  LongText,
  Skeleton,
  StatusChip,
  ToastViewport,
} from "../../../components/ui/core.jsx";
import { DeviceUpdateCard, UpdateProgressModal } from "../../dashboard/components/updates.jsx";
import { PublicLinkActions, SiteFooter } from "../components/GuestActions.jsx";

export function GuestConsole({ deviceId }) {
  const [state, setState] = useState({ device: null, service: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toastItems, setToastItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [commandModal, setCommandModal] = useState({
    open: false,
    action: "",
    title: "",
    message: "",
  });

  function dismissToast(id) {
    setToastItems((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(title, message = "", tone = "info") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToastItems((current) => [...current, { id, title, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToastItems((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }

  function handleGuestFeedback(message, tone = "info", title = "") {
    if (!message) {
      return;
    }
    pushToast(title || (tone === "error" ? "Aksi belum berhasil" : "Aksi berhasil"), message, tone);
  }

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
      if (options.announce) {
        pushToast("Status diperbarui", "Informasi guest access sudah disegarkan.", "success");
      }
    } catch (nextError) {
      const message = formatEdgeFunctionError(nextError);
      setError(message);
      if (options.announce) {
        pushToast("Gagal memuat status", message, "error");
      }
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
    const channel = legacyDataClient
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
      pushToast(
        isUpdateAction ? "Update dimulai" : action === "start" ? "Perintah start dikirim" : "Perintah stop dikirim",
        isUpdateAction
          ? "Agent akan menghentikan layanan, memasang versi baru, lalu aktif kembali otomatis."
          : action === "start"
            ? "Layanan E-Rapor sedang disiapkan."
            : "Permintaan penghentian layanan sedang dijalankan.",
        "success"
      );
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
      const message = formatEdgeFunctionError(nextError);
      setError(message);
      pushToast("Perintah gagal", message, "error");
      setCommandModal((current) => ({ ...current, open: true, message }));
    } finally {
      setBusy(false);
    }
  }

  function handleOpenService(event) {
    if (!canOpenService || !service?.public_url) {
      event?.preventDefault?.();
      handleGuestFeedback("Tautan belum aktif. Pastikan perangkat online dan layanan berjalan.", "error", "Tautan belum tersedia");
      return;
    }
    pushToast("Membuka E-Rapor", "Tautan publik dibuka di tab baru.", "success");
    window.open(service.public_url, "_blank", "noopener,noreferrer");
  }

  const service = state.service;
  const guestStatus = getGuestStatusModel(state.device, service);
  const guestRuntimeStatus =
    guestStatus.overallStatus === "ready" || guestStatus.overallStatus === "degraded"
      ? "running"
      : guestStatus.overallStatus;
  const guestRuntimeBadge = getServiceStatusBadgeModel(guestRuntimeStatus);
  const guestUpdate = getDeviceUpdateModel(state.device);
  const canOpenService = guestStatus.ready;
  const isRunning = service?.status === "running" && service?.desired_state !== "stopped";
  const isDeviceOffline =
    state.device?.deviceStatus === "offline" ||
    guestStatus.overallStatus === "offline" ||
    guestStatus.overallStatus === "blocked";
  const serviceLabel = formatServiceDisplayName(service?.service_name || "rapor");
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

  const guestMetricItems = [
    {
      label: "Status layanan",
      value: guestStatus.runtimeLabel,
      helper: `${serviceLabel} pada perangkat ini`,
      icon: Server,
      tone: guestRuntimeBadge.status === "running" ? "good" : guestRuntimeBadge.status === "error" ? "warn" : "",
    },
    {
      label: "Tautan akses",
      value: guestStatus.publicLabel,
      helper: "Ketersediaan URL publik E-Rapor",
      icon: CircleArrowUp,
      tone: guestStatus.publicStatus === "ready" ? "good" : guestStatus.publicStatus === "disabled" ? "warn" : "",
    },
    {
      label: "Terakhir tersambung",
      value: formatRelativeTime(state.device?.lastSeen),
      helper: "Heartbeat agent terbaru",
      icon: Activity,
    },
  ];

  const accessHint = guestStatus.ready
    ? "Buka tautan publik atau gunakan kontrol layanan di bawah saat diperlukan."
    : guestStatus.publicStatus === "disabled"
      ? "Perangkat atau layanan belum siap, jadi tautan publik belum tersedia."
      : "Status akan diperbarui otomatis begitu perangkat kembali stabil.";

  return (
    <main className={`console-shell guest-console-shell route-guest ${isDeviceOffline ? "is-device-offline" : ""}`.trim()}>
      <div className="guest-shell-inner">
        <header className="top-command-bar guest-top-command-bar guest-top-command-surface" aria-label="Status dan aksi guest access">
          <div className="workspace-switcher guest-workspace-switcher">
            <Avatar3D size="sm" />
            <div>
              <strong>{state.device?.deviceName || "Perangkat tamu"}</strong>
              <small>{state.device?.deviceId || deviceId}</small>
            </div>
          </div>
          <div className="guest-top-command-actions">
            <ActionButton className="secondary-button guest-refresh-button" busy={refreshing} icon={RefreshCw} onClick={() => loadGuest({ silent: true, announce: true })}>
              Segarkan
            </ActionButton>
            <a className="secondary-button footer-link-button action-button" href={loginUrl}>
              <span>Login</span>
            </a>
            <a className="primary-button footer-link-button action-button" href={registerUrl}>
              <span>Daftar</span>
            </a>
          </div>
        </header>

        <section className="guest-hero-grid guest-hero-grid-single">
          <article className={`guest-hero-copy guest-panel guest-status-hero tone-${statusTone(guestRuntimeStatus)}`}>
            <div className="guest-status-hero-copy">
              <span className="section-eyebrow">Status layanan</span>
              <h1>{guestStatus.headline}</h1>
              <p>{accessHint}</p>
              <div className="guest-hero-status">
                <StatusChip status={guestRuntimeBadge.status} label={guestStatus.runtimeChipLabel} />
                <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
              </div>
            </div>
          </article>
        </section>

        {error ? <div className="error-banner guest-error-banner">{error}</div> : null}

        <section className="fresh-console-stage guest-console-stage">
        {loading ? (
          <section className="guest-loading-shell" aria-busy="true" aria-label="Memuat status perangkat">
            <div className="guest-loading-layout">
              <article className="guest-panel guest-loading-card guest-loading-card-wide">
                <Skeleton lines={3} />
              </article>
              <article className="guest-panel guest-loading-card">
                <Skeleton lines={4} />
              </article>
              <article className="guest-panel guest-loading-card">
                <Skeleton lines={3} />
              </article>
              <article className="guest-panel guest-loading-card">
                <Skeleton lines={3} />
              </article>
              <article className="guest-panel guest-loading-card">
                <Skeleton lines={3} />
              </article>
            </div>
          </section>
        ) : (
          <section className="guest-main-layout">
            <article className={`guest-panel guest-access-main tone-${statusTone(guestRuntimeStatus)}`}>
              <div className="guest-access-main-head">
                <div>
                  <span className="section-eyebrow">Panel layanan</span>
                  <strong>{serviceLabel}</strong>
                  <p>Buka tautan publik, periksa status layanan, dan jalankan kontrol dasar dari satu panel.</p>
                </div>
              </div>

              <div className="guest-access-main-grid">
                <section className="guest-access-main-primary guest-subpanel">
                  <div className="guest-subpanel-head">
                    <div>
                      <span className="section-eyebrow">Tautan publik</span>
                      <strong>Tautan E-Rapor</strong>
                    </div>
                    <small>{canOpenService ? "Siap dibuka" : "Menunggu layanan aktif"}</small>
                  </div>
                  <div className="guest-link-focus-box guest-link-hero-box">
                    <LongText
                      value={service?.public_url || ""}
                      href={canOpenService ? service?.public_url : ""}
                      label="Tautan E-Rapor"
                      className="mono"
                      maxLength={96}
                      empty="Belum tersedia"
                      onCopySuccess={() => handleGuestFeedback("Tautan publik berhasil disalin.", "success", "Tautan disalin")}
                      onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin tautan publik.", "error", "Salin gagal")}
                    />
                  </div>
                  <div className="guest-link-focus-actions guest-link-hero-actions">
                    <ActionButton
                      className="primary-button guest-open-button"
                      disabled={busy}
                      onClick={handleOpenService}
                    >
                      Buka E-Rapor
                    </ActionButton>
                    <PublicLinkActions
                      url={service?.public_url || ""}
                      label={`Tautan ${serviceLabel} untuk ${state.device?.deviceName || deviceId}`}
                      compact
                      onActionComplete={setError}
                      onFeedback={handleGuestFeedback}
                    />
                  </div>
                </section>

                <section className="guest-access-main-side guest-subpanel">
                  <div className="guest-subpanel-head">
                    <div>
                      <span className="section-eyebrow">Status service</span>
                      <strong>{state.device?.deviceName || deviceId}</strong>
                    </div>
                    <small className="mono">{state.device?.deviceId || deviceId}</small>
                  </div>
                  <div className="guest-detail-grid">
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
                      <span>Lokasi aplikasi</span>
                      <div className="guest-detail-long mono">
                        <LongText
                          value={service?.resolved_path || ""}
                          label="Lokasi aplikasi"
                          maxLength={48}
                          onCopySuccess={() => handleGuestFeedback("Lokasi aplikasi berhasil disalin.", "success", "Lokasi disalin")}
                          onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin lokasi aplikasi.", "error", "Salin gagal")}
                        />
                      </div>
                    </div>
                    <div>
                      <span>Kesiapan aplikasi</span>
                      <strong>{service?.location_status || "unknown"}</strong>
                    </div>
                  </div>

                  <div className="guest-cta-row">
                    <ActionButton className="primary-button" busy={busy && commandModal.action === "start"} disabled={busy} onClick={() => sendCommand("start")}>
                      Mulai
                    </ActionButton>
                    <ActionButton className="secondary-button" busy={busy && commandModal.action === "stop"} disabled={busy || !isRunning} onClick={() => sendCommand("stop")}>
                      Hentikan
                    </ActionButton>
                    <ActionButton className="secondary-button" busy={busy && commandModal.action === "update"} disabled={busy} onClick={() => sendCommand("update")}>
                      Update
                    </ActionButton>
                  </div>
                </section>
              </div>

              {service?.location_details?.message ? (
                <div className="guest-inline-note">
                  <LongText
                    value={service.location_details.message}
                    label="Detail lokasi"
                    maxLength={72}
                    onCopySuccess={() => handleGuestFeedback("Detail lokasi berhasil disalin.", "success", "Detail disalin")}
                    onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin detail lokasi.", "error", "Salin gagal")}
                  />
                </div>
              ) : null}
              {service?.last_error ? (
                <div className="guest-inline-error">
                  <LongText
                    value={service.last_error}
                    label="Error layanan"
                    maxLength={72}
                    onCopySuccess={() => handleGuestFeedback("Pesan error layanan berhasil disalin.", "success", "Error disalin")}
                    onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin pesan error.", "error", "Salin gagal")}
                  />
                </div>
              ) : null}
            </article>

            <section className="guest-status-grid">
              {guestMetricItems.map((item) => (
                <article key={item.label} className={`guest-panel guest-metric-card ${item.tone ? `tone-${item.tone}` : ""}`}>
                  <span className="guest-metric-icon" aria-hidden="true">
                    <item.icon size={18} strokeWidth={2.2} />
                  </span>
                  <div className="guest-metric-copy">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.helper ? <small>{item.helper}</small> : null}
                  </div>
                </article>
              ))}
              <FeatureGuestUpdateCard
                deviceRecord={state.device}
                deviceStatus={state.device?.deviceStatus}
                busy={busy && commandModal.action === "update"}
                onUpdate={() => sendCommand("update")}
                showAction
              />
            </section>
          </section>
        )}
        </section>
        <SiteFooter />
      </div>
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
          <CommandProgressOverlay open title={commandModal.title} message={commandModal.message} percent={busy ? 42 : 78} />
        )
      ) : null}
      <ToastViewport items={toastItems} onDismiss={dismissToast} />
    </main>
  );
}

function FeatureGuestUpdateCard(props) {
  return (
    <div className="guest-update-card-wrap">
      <DeviceUpdateCard {...props} />
    </div>
  );
}
