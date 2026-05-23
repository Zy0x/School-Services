import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import githubIcon from "../../../assets/icons/github.png";
import paypalIcon from "../../../assets/icons/paypal.png";
import trakteerIcon from "../../../assets/icons/trakteer.png";
import { copyTextToClipboard } from "../../../app/lib/browser.js";
import { buildWhatsAppShareUrl } from "../../../app/lib/guest.js";
import { ActionButton } from "../../../components/ui/core.jsx";

const PAYPAL_URL = "https://paypal.me/theamagenta";
const TRAKTEER_URL = "https://trakteer.id/zy0x";
const GITHUB_PROFILE_URL = "https://github.com/Zy0x";

function useTransientMessage(duration = 2600) {
  const [message, setMessage] = useState("");
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  function showMessage(nextMessage) {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    setMessage(nextMessage);
    if (nextMessage) {
      timerRef.current = window.setTimeout(() => {
        setMessage("");
        timerRef.current = null;
      }, duration);
    }
  }

  return [message, showMessage];
}

function WhatsAppIcon({ size = 16, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M12.02 3.35a8.42 8.42 0 0 0-7.18 12.83l-.96 3.5 3.62-.94a8.41 8.41 0 1 0 4.52-15.39Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12.02 2.75a9.02 9.02 0 0 0-7.82 13.5l-1.08 3.95a.72.72 0 0 0 .88.88l4.08-1.06a9.02 9.02 0 1 0 3.94-17.27Zm0 1.52a7.5 7.5 0 1 1-3.58 14.1.75.75 0 0 0-.55-.06l-2.96.77.78-2.85a.75.75 0 0 0-.09-.6 7.5 7.5 0 0 1 6.4-11.36Z"
        fill="currentColor"
      />
      <path
        d="M8.9 7.86c.18-.37.37-.38.54-.38h.46c.15 0 .36.05.55.44.2.43.67 1.49.73 1.6.05.1.09.23.01.37-.07.15-.11.23-.23.36l-.34.38c-.1.12-.22.25-.1.46.12.2.55.9 1.19 1.45.82.73 1.5.96 1.73 1.07.22.1.35.09.48-.06.14-.16.55-.65.7-.87.15-.23.3-.18.5-.11.2.07 1.32.62 1.55.73.22.12.37.17.42.27.05.1.05.6-.13 1.16-.18.55-1.05 1.05-1.45 1.09-.37.04-.84.06-1.36-.08-.31-.08-.71-.23-1.23-.45-2.16-.93-3.58-3.1-3.69-3.24-.1-.14-.88-1.17-.88-2.24 0-1.07.56-1.6.76-1.82Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SupportIcon({ kind }) {
  const icons = {
    github: githubIcon,
    paypal: paypalIcon,
    trakteer: trakteerIcon,
  };
  return <img src={icons[kind] || trakteerIcon} alt="" aria-hidden="true" />;
}

export function PublicLinkActions({
  url,
  label = "Tautan akses",
  compact = false,
  tunnelProvider = "",
  ngrokWarningUrl = "",
  serverName = "",
  targetName = "",
  onActionComplete = null,
  onFeedback = null,
}) {
  const [feedback, showFeedback] = useTransientMessage();
  const disabled = !url;

  async function handleCopy() {
    if (!url) {
      return;
    }

    try {
      await copyTextToClipboard(url);
      showFeedback("Tautan berhasil disalin.");
      onActionComplete?.("");
      onFeedback?.("Tautan berhasil disalin.", "success", "Tautan disalin");
    } catch (error) {
      const message = error?.message || "Gagal menyalin tautan.";
      showFeedback(message);
      onActionComplete?.(message);
      onFeedback?.(message, "error", "Salin gagal");
    }
  }

  function handleWhatsAppShare() {
    if (!url) {
      return;
    }

    window.open(
      buildWhatsAppShareUrl(url, label, {
        tunnelProvider,
        ngrokWarningUrl: ngrokWarningUrl || url,
        serverName,
        targetName,
      }),
      "_blank",
      "noopener,noreferrer"
    );
    showFeedback("Tautan siap dibagikan lewat WhatsApp.");
    onActionComplete?.("");
    onFeedback?.("Tautan siap dibagikan lewat WhatsApp.", "success", "Siap dibagikan");
  }

  return (
    <div className={`link-action-stack ${compact ? "link-action-stack-compact" : ""}`}>
      <div className="panel-actions public-link-actions">
        <ActionButton className="secondary-button action-copy" disabled={disabled} icon={Copy} onClick={handleCopy}>
          Salin tautan
        </ActionButton>
        <ActionButton className="secondary-button action-share whatsapp-share-button" disabled={disabled} icon={WhatsAppIcon} onClick={handleWhatsAppShare}>
          Bagikan WhatsApp
        </ActionButton>
      </div>
      {feedback ? <div className="micro-feedback" role="status" aria-live="polite">{feedback}</div> : null}
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer guest-site-footer">
      <div className="site-footer-copy guest-site-footer-copy">
        <strong>School Services v2.0.9</strong>
        <p>Akses cepat untuk membuka E-Rapor dan melihat status perangkat tanpa panel yang berlebihan.</p>
      </div>
      <div className="support-cluster guest-support-cluster">
        <div className="support-cluster-copy guest-support-copy">
          <span className="section-eyebrow">Support</span>
          <strong>Dukung School Services</strong>
        </div>
        <div className="site-footer-actions guest-site-footer-actions">
          <a className="secondary-button action-session footer-link-button support-link-button" href={GITHUB_PROFILE_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="github" />
            GitHub
          </a>
          <a className="secondary-button action-session footer-link-button support-link-button" href={PAYPAL_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="paypal" />
            PayPal
          </a>
          <a className="secondary-button action-session footer-link-button support-link-button" href={TRAKTEER_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="trakteer" />
            Trakteer
          </a>
        </div>
      </div>
    </footer>
  );
}
