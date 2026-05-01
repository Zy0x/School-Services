import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Eye, Info, Loader2, MoreHorizontal, X } from "lucide-react";
import {
  copyTextToClipboard,
  dismissOnBackdrop,
  maskReferralCode,
  normalizeEmailInput,
  normalizeUrlInput,
  truncateText,
} from "../../app/lib/browser.js";
import { getStatusIcon, getStatusLabel, statusTone } from "../../app/lib/status.js";

export function StatusPill({ status, label, className = "", iconOnly = false, title = "" }) {
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

export function StatusChip(props) {
  return <StatusPill {...props} />;
}

export function IconButton({ label, icon: Icon = MoreHorizontal, className = "", ...props }) {
  return (
    <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

export function InfoHint({ text }) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text}>
      <Info size={14} strokeWidth={2.4} aria-hidden="true" />
      <span className="info-hint-bubble">{text}</span>
    </span>
  );
}

export function ToastViewport({ items = [], onDismiss }) {
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

export function CommandProgressOverlay({
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

export function ActionButton({
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

export function Skeleton({ className = "", lines = 1 }) {
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

export function PageSkeleton({ title = "Memuat data" }) {
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

export function GuestStatusSkeleton() {
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

export function MaskedTextField({
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

export function DetailDrawer({ title = "Detail", value, onClose }) {
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

export function ConfirmDialog({
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

export function LongText({
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
              .then(() => onCopySuccess?.(text, label))
              .catch((error) => onCopyError?.(error, label))
          }
        />
        <IconButton label={`Lihat ${label}`} icon={Eye} onClick={() => setOpen(true)} />
      </span>
      {open ? <DetailDrawer title={label} value={text} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

export function PasswordField({
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

export function ProfileInfoField({ label, value, mono = false }) {
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
