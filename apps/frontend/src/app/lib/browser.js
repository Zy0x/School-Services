export function dismissOnBackdrop(event, onClose) {
  if (event.target === event.currentTarget) {
    onClose?.();
  }
}

export function normalizeEmailInput(value) {
  return String(value || "").trim().toLowerCase();
}

export function maskReferralCode(value) {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function normalizeUrlInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function truncateText(value, maxLength = 42) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(12, maxLength - 12))}...${text.slice(-8)}`;
}

export async function copyTextToClipboard(text) {
  if (!text) {
    throw new Error("Tidak ada tautan yang bisa disalin.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "readonly");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}
