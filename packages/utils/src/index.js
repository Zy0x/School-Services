export function apiResponse(success, data = {}, message = "") {
  return { success, data, message };
}

export function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}
