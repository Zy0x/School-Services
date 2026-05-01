import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import githubIcon from "../../../assets/icons/github.png";
import paypalIcon from "../../../assets/icons/paypal.png";
import trakteerIcon from "../../../assets/icons/trakteer.png";
import { copyTextToClipboard } from "../../../app/lib/browser.js";
import { buildWhatsAppShareUrl } from "../../../app/lib/guest.js";
import { ActionButton } from "../../../components/ui/core.jsx";

const PAYPAL_URL = "https://paypal.me/theamagenta";
const TRAKTEER_URL = "https://trakteer.id/zy0x";
const GITHUB_PROFILE_URL = "https://github.com/Zy0x";

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
  onActionComplete = null,
  onFeedback = null,
}) {
  const [feedback, setFeedback] = useState("");
  const disabled = !url;

  async function handleCopy() {
    if (!url) {
      return;
    }

    try {
      await copyTextToClipboard(url);
      setFeedback("Tautan berhasil disalin.");
      onActionComplete?.("");
      onFeedback?.("Tautan berhasil disalin.", "success");
    } catch (error) {
      const message = error?.message || "Gagal menyalin tautan.";
      setFeedback("");
      onActionComplete?.(message);
      onFeedback?.(message, "error");
    }
  }

  function handleWhatsAppShare() {
    if (!url) {
      return;
    }

    window.open(buildWhatsAppShareUrl(url, label), "_blank", "noopener,noreferrer");
    setFeedback("Tautan siap dibagikan lewat WhatsApp.");
    onActionComplete?.("");
    onFeedback?.("Tautan siap dibagikan lewat WhatsApp.", "success");
  }

  return (
    <div className={`link-action-stack ${compact ? "link-action-stack-compact" : ""}`}>
      <div className="panel-actions public-link-actions">
        <ActionButton className="secondary-button" disabled={disabled} icon={Copy} onClick={handleCopy}>
          Salin tautan
        </ActionButton>
        <ActionButton className="secondary-button" disabled={disabled} icon={Share2} onClick={handleWhatsAppShare}>
          Bagikan WhatsApp
        </ActionButton>
      </div>
      {feedback ? <div className="micro-feedback">{feedback}</div> : null}
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-copy">
        <strong>School Services v2.0.4</strong>
        <p>Akses layanan sekolah dan pantau status E-Rapor dengan tampilan yang ringkas.</p>
      </div>
      <div className="support-cluster">
        <div className="support-cluster-copy">
          <span className="section-eyebrow">Buy Me a Coffee</span>
          <strong>Dukung School Services</strong>
        </div>
        <div className="site-footer-actions">
          <a className="secondary-button footer-link-button support-link-button" href={GITHUB_PROFILE_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="github" />
            Support GitHub
          </a>
          <a className="secondary-button footer-link-button support-link-button" href={PAYPAL_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="paypal" />
            PayPal
          </a>
          <a className="secondary-button footer-link-button support-link-button" href={TRAKTEER_URL} target="_blank" rel="noreferrer">
            <SupportIcon kind="trakteer" />
            Trakteer
          </a>
        </div>
      </div>
    </footer>
  );
}
