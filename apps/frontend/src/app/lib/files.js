export function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function safeFileNameFromKey(objectKey) {
  return String(objectKey || "").split("/").filter(Boolean).pop() || "berkas";
}

export function getJobStatusDetail(job) {
  if (job?.status === "running" && job?.result?.pendingUpload) {
    return "Berkas sudah siap. Menunggu koneksi internet untuk dikirim.";
  }

  if (job?.status === "completed" && Array.isArray(job?.result?.parts) && job.result.parts.length > 1) {
    return `Berkas tersedia dalam ${job.result.parts.length} bagian. Unduh semua bagian untuk menyusunnya kembali.`;
  }

  if (job?.status === "completed" && job?.artifact_bucket && job?.artifact_object_key) {
    return "Berkas siap diunduh.";
  }

  return "";
}

export function getFileKindLabel(item) {
  if (!item) {
    return "-";
  }
  if (item.type === "directory") {
    return "Folder";
  }
  const extension = String(item.name || "").split(".").pop();
  if (!extension || extension === item.name) {
    return "File";
  }
  return `${extension.toUpperCase()} file`;
}

export function getItemGlyph(item) {
  if (!item) {
    return "ITEM";
  }
  if (item.type === "directory") {
    return "DIR";
  }
  const extension = String(item.name || "").toLowerCase().split(".").pop();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "IMG";
  }
  if (["zip", "rar", "7z"].includes(extension)) {
    return "ZIP";
  }
  if (extension === "pdf") {
    return "PDF";
  }
  if (["txt", "md", "log", "json", "env", "ini", "sql"].includes(extension)) {
    return "TXT";
  }
  return "FILE";
}

export function buildBreadcrumbs(targetPath) {
  const value = String(targetPath || "").trim();
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\//g, "\\");
  const match = normalized.match(/^([A-Za-z]:\\)(.*)$/);
  if (!match) {
    return [{ label: normalized, path: normalized }];
  }

  const root = match[1];
  const rest = match[2];
  const parts = rest.split("\\").filter(Boolean);
  const crumbs = [{ label: root.replace(/\\$/, ""), path: root }];
  let cursor = root;

  for (const part of parts) {
    cursor = cursor.endsWith("\\") ? `${cursor}${part}` : `${cursor}\\${part}`;
    crumbs.push({ label: part, path: cursor });
  }

  return crumbs;
}

export function buildThisPcDirectoryResult(roots) {
  const source = Array.isArray(roots) ? roots : [];
  const driveRoots = source.filter((root) => String(root.root_type || "") === "drive");
  const items = (driveRoots.length ? driveRoots : source).map((root) => ({
    name: String(root.label || root.path || "Drive"),
    path: String(root.path || ""),
    type: "directory",
    size: null,
    modifiedAt: null,
    hidden: false,
    virtualKind: String(root.root_type || "drive"),
    description: String(root.metadata?.description || "").trim(),
    locationStatus: String(root.metadata?.locationStatus || root.root_type || "drive"),
  }));

  return {
    path: "",
    parentPath: "",
    items,
    warnings: [],
    virtualRootLabel: "This PC",
  };
}

export function formatArtifactDetailValue(artifact) {
  const parts = Array.isArray(artifact?.result?.parts) ? artifact.result.parts : [];
  const lines = [
    `Nama: ${artifact?.fileName || safeFileNameFromKey(artifact?.objectKey || "") || "-"}`,
    `Bucket: ${artifact?.bucket || "-"}`,
    `Path: ${artifact?.sourcePath || artifact?.objectKey || "-"}`,
    `Device: ${artifact?.deviceName || artifact?.deviceId || "-"}`,
    `Status: ${artifact?.status || "-"}`,
    `Waktu: ${formatDate(artifact?.createdAt || artifact?.completedAt)}`,
    `Ukuran: ${formatBytes(Number(artifact?.size || 0))}`,
  ];

  if (parts.length) {
    lines.push("", "Bagian ZIP:");
    parts.forEach((part, index) => {
      lines.push(`${index + 1}. ${part.fileName || safeFileNameFromKey(part.objectKey || "") || "-"}`);
      lines.push(`   Bucket: ${part.bucket || artifact?.bucket || "-"}`);
      lines.push(`   Key: ${part.objectKey || "-"}`);
    });
  }

  return lines.join("\n");
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
