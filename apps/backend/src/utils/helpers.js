export function ok(data = {}, message = "") {
  return { success: true, data, message };
}

export function fail(message = "Request failed", data = {}) {
  return { success: false, data, message };
}
