const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const {
  detectEol,
  escapeRegex,
  fileExists,
  normalizePublicUrl,
} = require("./utils");

function ensureBackup(filePath, originalContent) {
  const backupPath = `${filePath}.bak`;

  if (!fileExists(filePath) || fileExists(backupPath)) {
    return;
  }

  fs.writeFileSync(backupPath, originalContent, "utf8");
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeIfChanged(filePath, originalContent, nextContent) {
  if (originalContent === nextContent) {
    return false;
  }

  ensureParentDirectory(filePath);
  ensureBackup(filePath, originalContent);
  fs.writeFileSync(filePath, nextContent, "utf8");
  return true;
}

function formatKeyValueLine(key, value, fallbackSeparator = "=") {
  return `${key}${fallbackSeparator}${value}`;
}

function updateKeyValueDocument({
  content,
  key,
  replacementLine,
  matcher,
}) {
  const eol = detectEol(content);
  const hadTrailingNewline = /\r?\n$/.test(content);
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  if (hadTrailingNewline && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const output = [];
  let found = false;
  let changed = false;

  for (const line of lines) {
    if (!matcher.test(line)) {
      output.push(line);
      continue;
    }

    if (!found) {
      output.push(replacementLine);
      found = true;

      if (line !== replacementLine) {
        changed = true;
      }
      continue;
    }

    changed = true;
  }

  if (!found) {
    output.push(replacementLine);
    changed = true;
  }

  let nextContent = output.join(eol);

  if (hadTrailingNewline || nextContent.length > 0) {
    nextContent += eol;
  }

  return { changed, content: nextContent, key };
}

function readConfigSource(filePath, fallbackContent = "") {
  if (!fileExists(filePath)) {
    return fallbackContent;
  }

  return fs.readFileSync(filePath, "utf8");
}

function sanitizeFormatterUrl(publicUrl) {
  return String(publicUrl || "").trim().replace(/\/+$/, "");
}

function normalizeTargetUrlValue(value) {
  return normalizePublicUrl(String(value || "").trim());
}

function deriveTargetUrl(target, publicUrl, context = {}) {
  const urlSource = String(target?.urlSource || "public").toLowerCase();

  if (typeof target?.value === "string" && target.value.trim()) {
    return normalizeTargetUrlValue(target.value);
  }

  if (urlSource === "relative") {
    return "/";
  }

  if (urlSource === "local") {
    if (context.localUrl) {
      return normalizeTargetUrlValue(context.localUrl);
    }

    return normalizeTargetUrlValue(publicUrl);
  }

  return normalizeTargetUrlValue(publicUrl);
}

function renderScalarValue(target, publicUrl, context = {}) {
  const targetUrl = deriveTargetUrl(target, publicUrl, context);
  const sanitizedUrl = sanitizeFormatterUrl(targetUrl);
  const normalizedUrl = normalizeTargetUrlValue(targetUrl);

  if (typeof target.formatter === "function") {
    return target.formatter(sanitizedUrl);
  }

  if (typeof target.format === "function") {
    return target.format(sanitizedUrl);
  }

  if (typeof target.value === "function") {
    return target.value(normalizedUrl);
  }

  return normalizedUrl;
}

function buildLineValue(target, publicUrl, fallbackSeparator, context = {}) {
  if (typeof target.formatter === "function" || typeof target.format === "function") {
    return renderScalarValue(target, publicUrl, context);
  }

  return formatKeyValueLine(
    target.key,
    deriveTargetUrl(target, publicUrl, context),
    fallbackSeparator
  );
}

function updateEnvConfig(target, publicUrl, context = {}) {
  const filePath = target.path;
  const originalContent = readConfigSource(filePath, "");
  const key = target.key;
  const renderedLine = buildLineValue(target, publicUrl, " = ", context);
  const matcher = new RegExp(
    `^\\s*[#;]?\\s*${escapeRegex(key)}\\s*=.*$`,
    "i"
  );
  const result = updateKeyValueDocument({
    content: originalContent,
    key,
    replacementLine: renderedLine,
    matcher,
  });

  return {
    changed: result.changed
      ? writeIfChanged(filePath, originalContent, result.content)
      : false,
    path: filePath,
  };
}

function updateIniConfig(target, publicUrl, context = {}) {
  const filePath = target.path;
  const originalContent = readConfigSource(filePath, "");
  const key = target.key;
  const renderedLine = buildLineValue(target, publicUrl, "=", context);
  const matcher = new RegExp(`^\\s*[;#]?\\s*${escapeRegex(key)}\\s*=.*$`, "i");
  const result = updateKeyValueDocument({
    content: originalContent,
    key,
    replacementLine: renderedLine,
    matcher,
  });

  return {
    changed: result.changed
      ? writeIfChanged(filePath, originalContent, result.content)
      : false,
    path: filePath,
  };
}

function getJsonIndent(content) {
  const indentMatch = content.match(/\n( +)"/);
  return indentMatch ? indentMatch[1].length : 2;
}

function setNestedValue(targetObject, keyPath, nextValue) {
  const segments = keyPath.split(".");
  let cursor = targetObject;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (
      !Object.prototype.hasOwnProperty.call(cursor, segment) ||
      typeof cursor[segment] !== "object" ||
      cursor[segment] === null
    ) {
      cursor[segment] = {};
    }

    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = nextValue;
}

function getNestedValue(targetObject, keyPath) {
  return keyPath.split(".").reduce((cursor, segment) => {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }

    return cursor[segment];
  }, targetObject);
}

function updateJsonConfig(target, publicUrl, context = {}) {
  const filePath = target.path;
  const originalContent = readConfigSource(filePath, "{}\n");
  const payload = JSON.parse(originalContent || "{}");
  const nextValue = renderScalarValue(target, publicUrl, context);
  const currentValue = getNestedValue(payload, target.key);

  if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) {
    return { changed: false, path: filePath };
  }

  setNestedValue(payload, target.key, nextValue);
  const indent = getJsonIndent(originalContent);
  const nextContent = `${JSON.stringify(payload, null, indent)}\n`;

  return {
    changed: writeIfChanged(filePath, originalContent, nextContent),
    path: filePath,
  };
}

function updateMappedConfig(target, publicUrl, context = {}) {
  if (!target || !target.type || !target.key) {
    throw new Error(`Invalid config target: ${JSON.stringify(target)}`);
  }

  if (!target.path) {
    logger.warn(
      `Skipping config update for key ${target.key}: config path is not defined.`
    );
    return { changed: false, path: null, skipped: true };
  }

  if (target.type === "env") {
    return updateEnvConfig(target, publicUrl, context);
  }

  if (target.type === "json") {
    return updateJsonConfig(target, publicUrl, context);
  }

  if (target.type === "ini") {
    return updateIniConfig(target, publicUrl, context);
  }

  throw new Error(`Unsupported config type: ${target.type}`);
}

module.exports = {
  updateMappedConfig,
};
