class UrlCache {
  constructor() {
    this.cache = new Map();
  }

  hasChanged(serviceName, publicUrl) {
    return this.cache.get(serviceName) !== publicUrl;
  }

  remember(serviceName, publicUrl) {
    this.cache.set(serviceName, publicUrl);
  }

  clear(serviceName) {
    this.cache.delete(serviceName);
  }
}

module.exports = UrlCache;
