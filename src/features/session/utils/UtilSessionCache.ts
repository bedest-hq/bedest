/**
 * Small in-process LRU of session ids known to be active. Entries expire
 * after `ttlMs` (or at the session's own expiry, whichever is first), so a
 * revocation on another node is picked up within `ttlMs` even without Redis.
 */
export class UtilSessionCache {
  private entries = new Map<string, number>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxSize = 10_000,
  ) {}

  has(sessionId: string, nowMs: number): boolean {
    const expiresAt = this.entries.get(sessionId);
    if (expiresAt === undefined) {
      return false;
    }
    this.entries.delete(sessionId);
    if (expiresAt <= nowMs) {
      return false;
    }
    // Re-insert to mark as most recently used.
    this.entries.set(sessionId, expiresAt);
    return true;
  }

  set(sessionId: string, nowMs: number, sessionExpiresAtMs: number) {
    this.entries.delete(sessionId);
    this.entries.set(sessionId, Math.min(nowMs + this.ttlMs, sessionExpiresAtMs));
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  delete(sessionId: string) {
    this.entries.delete(sessionId);
  }

  clear() {
    this.entries.clear();
  }
}
