import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CircleArrowUp, ChevronDown, Monitor, RefreshCw, Server, Sparkles } from "lucide-react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { REFRESH_INTERVAL_MS } from "../../../app/lib/constants.js";
import { formatEdgeFunctionError } from "../../../app/lib/errors.js";
import { buildAuthUrl } from "../../../app/lib/routes.js";
import {
  formatRelativeTime,
  formatServiceDisplayName,
  getDeviceStatusBadgeModel,
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
} from "../../../components/ui/core.jsx";
import { DeviceUpdateCard, UpdateProgressModal } from "../../dashboard/components/updates.jsx";
import { PublicLinkActions, SiteFooter } from "../components/GuestActions.jsx";

export function GuestConsole({ deviceId }) {
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
      setCommandModal((current) => ({ ...current, open: true, message }));
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

  const guestPriorityTone =
    guestStatus.overallStatus === "ready"
      ? "good"
      : ["offline", "blocked", "failed", "error"].includes(guestStatus.overallStatus)
        ? "warn"
        : "files";
  const GuestPriorityIcon =
    guestStatus.overallStatus === "ready"
      ? Sparkles
      : guestStatus.overallStatus === "offline" || guestStatus.overallStatus === "blocked"
        ? AlertTriangle
        : Monitor;
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

  const accessSummary =
    guestStatus.ready
      ? "Tautan publik aktif dan siap dibuka."
      : guestStatus.publicStatus === "disabled"
        ? "Tautan belum tersedia karena perangkat atau layanan belum siap."
        : "Tautan publik akan aktif setelah perangkat stabil kembali.";

  const heroTitle = guestStatus.ready ? "Buka E-Rapor" : "Akses E-Rapor";

  return (
    <main className="console-shell guest-console-shell route-guest">
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
            <ActionButton className="secondary-button" busy={refreshing} icon={RefreshCw} onClick={() => loadGuest({ silent: true })}>
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

        <section className="guest-hero-grid">
          <article className="guest-hero-copy guest-panel">
            <nav className="route-breadcrumbs guest-breadcrumbs" aria-label="Breadcrumb">
              <span className="route-breadcrumb-item"><span>Guest</span></span>
              <span className="route-breadcrumb-item"><ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" /><span>{serviceLabel}</span></span>
            </nav>
            <span className="section-eyebrow">Akses tamu</span>
            <h1>{heroTitle}</h1>
            <p>{guestStatus.description}</p>
            <div className="guest-hero-status">
              <StatusChip status={deviceBadge.status} label={deviceBadge.label} />
              <StatusChip status={guestRuntimeBadge.status} label={guestStatus.runtimeChipLabel} />
              <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
            </div>
          </article>

          <article className="guest-panel guest-access-hero">
            <div className="guest-access-hero-head">
              <span className="guest-access-icon" aria-hidden="true">
                <CircleArrowUp size={18} strokeWidth={2.2} />
              </span>
              <div>
                <span className="section-eyebrow">Tautan utama</span>
                <strong>Tautan E-Rapor</strong>
              </div>
            </div>
            <div className="guest-link-focus-box guest-link-hero-box">
              <LongText
                value={service?.public_url || ""}
                href={canOpenService ? service?.public_url : ""}
                label="Tautan E-Rapor"
                className="mono"
                maxLength={96}
                empty="Belum tersedia"
              />
            </div>
            <p className="guest-access-summary">{accessSummary}</p>
            <div className="guest-link-focus-actions guest-link-hero-actions">
              <a
                className={`primary-button footer-link-button guest-open-button ${canOpenService ? "" : "button-disabled-link"}`}
                href={canOpenService ? service?.public_url : undefined}
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
              <GuestPublicLinkActions
                url={service?.public_url || ""}
                label={`Tautan ${serviceLabel} untuk ${state.device?.deviceName || deviceId}`}
                compact
                onActionComplete={setError}
              />
            </div>
          </article>
        </section>

        <section className={`guest-status-banner tone-${guestPriorityTone}`}>
          <span className="guest-status-banner-icon" aria-hidden="true">
            <GuestPriorityIcon size={20} strokeWidth={2.2} />
          </span>
          <div>
            <strong>{guestStatus.headline}</strong>
            <p>
              {guestStatus.ready
                ? "Perangkat tersambung, layanan aktif, dan tautan publik siap dipakai."
                : "Halaman ini tetap menampilkan status koneksi dan jalur akses secara ringkas sampai perangkat siap."}
            </p>
          </div>
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

            <article className={`guest-panel guest-service-panel tone-${statusTone(guestRuntimeStatus)}`}>
              <div className="guest-service-head">
                <div>
                  <span className="section-eyebrow">Service</span>
                  <strong>{serviceLabel}</strong>
                  <small className="mono">{state.device?.deviceId || deviceId}</small>
                </div>
                <div className="guest-service-pills">
                  <StatusChip status={deviceBadge.status} label={deviceBadge.label} />
                  <StatusChip status={guestRuntimeBadge.status} label={guestStatus.runtimeChipLabel} />
                  <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
                </div>
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
                  <strong className="mono">
                    <LongText value={service?.resolved_path || ""} label="Lokasi aplikasi" maxLength={48} />
                  </strong>
                </div>
                <div>
                  <span>Kesiapan aplikasi</span>
                  <strong>{service?.location_status || "unknown"}</strong>
                </div>
              </div>

              {service?.location_details?.message ? (
                <div className="guest-inline-note">
                  <LongText value={service.location_details.message} label="Detail lokasi" maxLength={72} />
                </div>
              ) : null}
              {service?.last_error ? (
                <div className="guest-inline-error">
                  <LongText value={service.last_error} label="Error layanan" maxLength={72} />
                </div>
              ) : null}

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
            </article>
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
