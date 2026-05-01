export const logger = {
  info: (...args) => console.info("[api]", ...args),
  warn: (...args) => console.warn("[api]", ...args),
  error: (...args) => console.error("[api]", ...args),
};
