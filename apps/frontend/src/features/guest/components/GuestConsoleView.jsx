import { RefreshCw } from "lucide-react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { buildNgrokVisitSiteNotice } from "../../../app/lib/guest.js";
import { formatRelativeTime, statusTone } from "../../../app/lib/status.js";
import {
  ActionButton,
  CommandProgressOverlay,
  LongText,
  Skeleton,
  StatusChip,
  ToastViewport,
} from "../../../components/ui/core.jsx";
import { PublicLinkActions, SiteFooter } from "./GuestActions.jsx";

export function GuestConsoleView({
  activeCommand,
  activeCommandAction,
  activeCommandMessage,
  activeCommandPercent,
  activeCommandStatus,
  accessHint,
  agentBadge,
  agentControlMessage,
  agentStatus,
  busy,
  canOpenService,
  cancelActiveCommand,
  cancelingCommandId,
  commandModal,
  connectivityBadge,
  deviceId,
  dismissToast,
  error,
  guestRuntimeBadge,
  guestRuntimeStatus,
  guestStatus,
  guestUpdate,
  guestUpdateSummary,
  handleGuestFeedback,
  handleOpenService,
  isDeviceOffline,
  isDeviceOnline,
  loadGuest,
  loading,
  loginUrl,
  offlineUpdateMessage,
  refreshing,
  registerUrl,
  recoveryDisabled,
  sendCommand,
  service,
  serviceLabel,
  serviceTarget,
  setCommandModal,
  setError,
  showNgrokVisitSiteNotice,
  startDisabled,
  state,
  stopDisabled,
  toastItems,
  tunnelProviderBadge,
  unsupportedUpdateMessage,
  updateButtonLabel,
  updateDisabled,
}) {
  return (
    <main className={`console-shell guest-console-shell route-guest ${isDeviceOnline ? "is-device-online" : ""} ${isDeviceOffline ? "is-device-offline" : ""}`.trim()}>
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
            <ActionButton className="secondary-button action-refresh guest-refresh-button" busy={refreshing} icon={RefreshCw} onClick={() => loadGuest({ silent: true, announce: true })}>
              Segarkan
            </ActionButton>
            <a className="secondary-button action-session footer-link-button action-button" href={loginUrl}>
              <span>Login</span>
            </a>
            <a className="primary-button action-create footer-link-button action-button" href={registerUrl}>
              <span>Daftar</span>
            </a>
          </div>
        </header>

        {error ? <div className="error-banner guest-error-banner">{error}</div> : null}

        <section className="fresh-console-stage guest-console-stage">
        {loading ? (
          <section className="guest-loading-shell" aria-busy="true" aria-label="Memuat status perangkat">
            <div className="guest-loading-layout">
              <article className="guest-panel guest-loading-card guest-loading-card-wide">
                <Skeleton lines={7} />
              </article>
            </div>
          </section>
        ) : (
          <section className="guest-main-layout guest-main-layout-streamlined">
            <article className={`guest-panel guest-access-main guest-access-card tone-${statusTone(guestRuntimeStatus)}`}>
              <div className="guest-access-card-head">
                <div className="guest-access-title">
                  <span className="section-eyebrow">Guest access</span>
                  <h1>{guestStatus.headline}</h1>
                  <p>{accessHint}</p>
                </div>
                <div className="guest-access-status-row">
                  <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
                  <StatusChip status={agentBadge.status} label={agentBadge.label} />
                  <StatusChip status={guestRuntimeBadge.status} label={guestStatus.runtimeChipLabel} />
                  <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
                  <StatusChip status={tunnelProviderBadge.status} label={tunnelProviderBadge.label} />
                </div>
              </div>

              <div className="guest-link-panel">
                <div className="guest-link-panel-top">
                  <div>
                    <span className="section-eyebrow">Tautan publik</span>
                    <strong>{canOpenService ? "Siap dibuka" : "Menunggu layanan aktif"}</strong>
                  </div>
                  <small>{serviceLabel}</small>
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
                    className="primary-button action-open guest-open-button"
                    disabled={busy || !canOpenService}
                    onClick={handleOpenService}
                  >
                    Buka E-Rapor
                  </ActionButton>
                  <PublicLinkActions
                    url={canOpenService ? service?.public_url || "" : ""}
                    label={`Tautan ${serviceLabel} untuk ${state.device?.deviceName || deviceId}`}
                    compact
                    tunnelProvider={service?.tunnel_provider}
                    ngrokWarningUrl={service?.public_url || ""}
                    serverName={serviceLabel}
                    targetName={state.device?.deviceName || deviceId}
                    onActionComplete={setError}
                    onFeedback={handleGuestFeedback}
                  />
                </div>
                {showNgrokVisitSiteNotice ? (
                  <div className="fresh-inline-note ngrok-visit-site-note">
                    {buildNgrokVisitSiteNotice(serviceLabel)}
                  </div>
                ) : null}
              </div>

              <div className="guest-service-facts" aria-label="Ringkasan perangkat dan layanan">
                <div>
                  <span>Perangkat</span>
                  <strong>{state.device?.deviceName || deviceId}</strong>
                  <small className="mono">{state.device?.deviceId || deviceId}</small>
                </div>
                <div>
                  <span>Heartbeat</span>
                  <strong>{formatRelativeTime(state.device?.lastSeen)}</strong>
                  <small>Agent terakhir tersambung</small>
                </div>
                <div>
                  <span>Status agent</span>
                  <strong>{agentBadge.label}</strong>
                  <small>{agentStatus === "stopped" ? "Kontrol layanan menunggu agent dinyalakan" : "Kondisi runtime School Services"}</small>
                </div>
                <div>
                  <span>Koneksi device</span>
                  <strong>{connectivityBadge.label}</strong>
                  <small>{state.device?.supervisorLastSeen ? `Supervisor ${formatRelativeTime(state.device.supervisorLastSeen)}` : "Menunggu heartbeat supervisor"}</small>
                </div>
                <div>
                  <span>Update service</span>
                  <strong>{formatRelativeTime(service?.last_ping)}</strong>
                  <small>Sinkronisasi status E-Rapor</small>
                </div>
                <div>
                  <span>Target layanan</span>
                  <strong>{serviceTarget}</strong>
                  <small>Status permintaan layanan</small>
                </div>
                <div>
                  <span>Kesiapan aplikasi</span>
                  <strong>{service?.location_status || "unknown"}</strong>
                  <small>Validasi lokasi E-Rapor</small>
                </div>
                <div>
                  <span>Update agent</span>
                  <strong>{guestUpdate.label}</strong>
                  <small>{guestUpdate.localVersion}</small>
                </div>
              </div>

              <div className="guest-control-band" aria-label="Kontrol layanan E-Rapor">
                <div className="guest-cta-row guest-control-actions">
                  <ActionButton className="primary-button action-start guest-cta-button guest-cta-start" busy={busy && commandModal.action === "start"} disabled={startDisabled} onClick={() => sendCommand("start")}>
                    Mulai
                  </ActionButton>
                  <ActionButton className="danger-button action-stop guest-cta-button guest-cta-stop" busy={busy && commandModal.action === "stop"} disabled={stopDisabled} onClick={() => sendCommand("stop")}>
                    Hentikan
                  </ActionButton>
                  <ActionButton
                    className="secondary-button action-update guest-cta-button guest-cta-update"
                    busy={(busy && commandModal.action === "update") || guestUpdate.status === "updating"}
                    disabled={updateDisabled}
                    onClick={() => sendCommand("update")}
                  >
                    {updateButtonLabel}
                  </ActionButton>
                  <ActionButton
                    className="secondary-button action-restart guest-cta-button guest-cta-recovery"
                    busy={busy && commandModal.action === "agent_restart"}
                    disabled={recoveryDisabled}
                    onClick={() => sendCommand("agent_restart")}
                  >
                    Pulihkan Agent
                  </ActionButton>
                </div>
                <p>{agentControlMessage || offlineUpdateMessage || unsupportedUpdateMessage || guestUpdateSummary}</p>
              </div>

              <details className="guest-detail-disclosure">
                <summary>
                  <span>Detail teknis</span>
                  <strong>Lokasi aplikasi, pesan layanan, dan error</strong>
                </summary>
                <div className="guest-detail-disclosure-body">
                  <div className="guest-detail-row">
                    <span>Lokasi aplikasi</span>
                    <div className="guest-detail-long mono">
                      <LongText
                        value={service?.resolved_path || ""}
                        label="Lokasi aplikasi"
                        maxLength={72}
                        empty="Belum tersedia"
                        onCopySuccess={() => handleGuestFeedback("Lokasi aplikasi berhasil disalin.", "success", "Lokasi disalin")}
                        onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin lokasi aplikasi.", "error", "Salin gagal")}
                      />
                    </div>
                  </div>
                  {service?.location_details?.message ? (
                    <div className="guest-detail-row guest-detail-note">
                      <span>Detail lokasi</span>
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
                    <div className="guest-detail-row guest-detail-error">
                      <span>Error layanan</span>
                      <LongText
                        value={service.last_error}
                        label="Error layanan"
                        maxLength={72}
                        onCopySuccess={() => handleGuestFeedback("Pesan error layanan berhasil disalin.", "success", "Error disalin")}
                        onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin pesan error.", "error", "Salin gagal")}
                      />
                    </div>
                  ) : null}
                </div>
              </details>
            </article>
          </section>
        )}
        </section>
        <SiteFooter />
      </div>
      <CommandProgressOverlay
        open={commandModal.open || Boolean(activeCommand)}
        title={commandModal.title || (activeCommandAction === "update" ? "Mengupdate Agent & Service" : "Perintah sedang diproses")}
        message={activeCommandMessage}
        percent={activeCommandPercent}
        phase={activeCommand?.phase || ""}
        status={activeCommandStatus || "running"}
        error={activeCommand?.error || ""}
        minimized={commandModal.minimized}
        cancelLabel={cancelingCommandId ? "Membatalkan..." : "Batalkan"}
        onMinimize={() => setCommandModal((current) => ({ ...current, minimized: true }))}
        onRestore={() => setCommandModal((current) => ({ ...current, minimized: false }))}
        onCancel={activeCommand?.id && ["pending", "running"].includes(activeCommandStatus) ? cancelActiveCommand : undefined}
        onClose={() =>
          setCommandModal((current) =>
            ["done", "failed"].includes(activeCommandStatus)
              ? {
                  open: false,
                  action: "",
                  title: "",
                  message: "",
                  commandId: null,
                  minimized: false,
                  status: "",
                }
              : current
          )
        }
      />
      <ToastViewport items={toastItems} onDismiss={dismissToast} />
    </main>
  );
}
