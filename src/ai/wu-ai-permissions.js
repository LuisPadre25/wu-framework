/**
 * WU-AI-PERMISSIONS: Security, rate limiting, circuit breaker, loop protection
 *
 * 4-layer defense:
 * 1. Permission flags (readStore, writeStore, emitEvents, etc.)
 * 2. Rate limiting (per-minute, per-namespace, concurrent)
 * 3. Circuit breaker (CLOSED → OPEN → HALF-OPEN)
 * 4. Loop protection (depth counter + causal chain tracking)
 */

import { logger } from '../core/wu-logger.js';

// ─── Permission Defaults ─────────────────────────────────────────

const DEFAULT_PERMISSIONS = {
  readStore: true,
  writeStore: false,
  emitEvents: true,
  readDOM: false,
  modifyDOM: false,
  executeActions: true,
  allowDirectKey: false,
};

// ─── Circuit Breaker States ──────────────────────────────────────

const CB_CLOSED = 'closed';
const CB_OPEN = 'open';
const CB_HALF_OPEN = 'half-open';

// ─── Rate Limiter ────────────────────────────────────────────────

class RateLimiter {
  constructor(config = {}) {
    this._maxPerMinute = config.requestsPerMinute ?? 20;
    this._maxPerMinutePerNs = config.requestsPerMinutePerNs ?? 10;
    this._maxConcurrent = config.maxConcurrent ?? 3;

    this._globalTimestamps = [];
    this._nsTimestamps = new Map();
    this._concurrent = 0;
  }

  configure(config) {
    if (config.requestsPerMinute !== undefined) this._maxPerMinute = config.requestsPerMinute;
    if (config.requestsPerMinutePerNs !== undefined) this._maxPerMinutePerNs = config.requestsPerMinutePerNs;
    if (config.maxConcurrent !== undefined) this._maxConcurrent = config.maxConcurrent;
  }

  canSend(namespace = 'default') {
    this._pruneOld();

    if (this._concurrent >= this._maxConcurrent) {
      return { allowed: false, reason: `Max concurrent (${this._maxConcurrent}) reached` };
    }
    if (this._globalTimestamps.length >= this._maxPerMinute) {
      return { allowed: false, reason: `Global rate limit (${this._maxPerMinute}/min) exceeded` };
    }

    const nsTs = this._nsTimestamps.get(namespace) || [];
    if (nsTs.length >= this._maxPerMinutePerNs) {
      return { allowed: false, reason: `Namespace '${namespace}' rate limit (${this._maxPerMinutePerNs}/min) exceeded` };
    }

    return { allowed: true };
  }

  recordStart(namespace = 'default') {
    const now = Date.now();
    this._globalTimestamps.push(now);
    if (!this._nsTimestamps.has(namespace)) this._nsTimestamps.set(namespace, []);
    this._nsTimestamps.get(namespace).push(now);
    this._concurrent++;
  }

  recordEnd() {
    this._concurrent = Math.max(0, this._concurrent - 1);
  }

  _pruneOld() {
    const cutoff = Date.now() - 60000;
    this._globalTimestamps = this._globalTimestamps.filter(t => t > cutoff);
    for (const [ns, timestamps] of this._nsTimestamps) {
      const pruned = timestamps.filter(t => t > cutoff);
      if (pruned.length === 0) this._nsTimestamps.delete(ns);
      else this._nsTimestamps.set(ns, pruned);
    }
  }

  getStats() {
    this._pruneOld();
    return {
      globalRequestsLastMinute: this._globalTimestamps.length,
      concurrent: this._concurrent,
      maxPerMinute: this._maxPerMinute,
      maxConcurrent: this._maxConcurrent,
    };
  }
}

// ─── Circuit Breaker ─────────────────────────────────────────────

class CircuitBreaker {
  constructor(config = {}) {
    this._state = CB_CLOSED;
    this._failureCount = 0;
    this._maxFailures = config.maxFailures ?? 3;
    this._cooldownMs = config.cooldownMs ?? 30000;
    this._openedAt = 0;
    this._rapidFireThreshold = config.rapidFireThreshold ?? 5;
    this._rapidFireWindowMs = config.rapidFireWindowMs ?? 2000;
    this._recentRequests = [];
  }

  configure(config) {
    if (config.maxFailures !== undefined) this._maxFailures = config.maxFailures;
    if (config.cooldownMs !== undefined) this._cooldownMs = config.cooldownMs;
  }

  canPass() {
    if (this._state === CB_CLOSED) return { allowed: true };

    if (this._state === CB_OPEN) {
      if (Date.now() - this._openedAt >= this._cooldownMs) {
        this._state = CB_HALF_OPEN;
        logger.wuDebug('[wu-ai] Circuit breaker → HALF-OPEN (testing)');
        return { allowed: true };
      }
      const remainingMs = this._cooldownMs - (Date.now() - this._openedAt);
      return { allowed: false, reason: `Circuit breaker OPEN (${Math.ceil(remainingMs / 1000)}s remaining)` };
    }

    // HALF-OPEN: allow one request through
    return { allowed: true };
  }

  recordSuccess() {
    if (this._state === CB_HALF_OPEN) {
      this._state = CB_CLOSED;
      this._failureCount = 0;
      logger.wuInfo('[wu-ai] Circuit breaker → CLOSED (recovered)');
    } else {
      this._failureCount = 0;
    }
    this._recordRequest();
  }

  recordFailure() {
    this._failureCount++;
    this._recordRequest();

    if (this._state === CB_HALF_OPEN) {
      this._tripOpen('Failed during half-open test');
      return;
    }

    if (this._failureCount >= this._maxFailures) {
      this._tripOpen(`${this._failureCount} consecutive failures`);
    }
  }

  _recordRequest() {
    const now = Date.now();
    this._recentRequests.push(now);
    this._recentRequests = this._recentRequests.filter(t => now - t < this._rapidFireWindowMs);

    if (this._state === CB_CLOSED && this._recentRequests.length >= this._rapidFireThreshold) {
      this._tripOpen(`${this._recentRequests.length} requests in ${this._rapidFireWindowMs}ms (rapid fire)`);
    }
  }

  _tripOpen(reason) {
    this._state = CB_OPEN;
    this._openedAt = Date.now();
    logger.wuWarn(`[wu-ai] Circuit breaker → OPEN: ${reason}. Cooldown: ${this._cooldownMs / 1000}s`);
  }

  getState() {
    return this._state;
  }

  getStats() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      maxFailures: this._maxFailures,
      cooldownMs: this._cooldownMs,
      openedAt: this._openedAt,
    };
  }

  reset() {
    this._state = CB_CLOSED;
    this._failureCount = 0;
    this._openedAt = 0;
    this._recentRequests = [];
  }
}

// ─── Loop Protection ─────────────────────────────────────────────

class LoopProtection {
  constructor(config = {}) {
    this._maxDepth = config.maxDepth ?? 3;
    this._activeTraces = new Map(); // traceId → count
    this._traceLog = [];            // last N traces for debugging
    this._maxTraceLog = 50;
  }

  configure(config) {
    if (config.maxDepth !== undefined) this._maxDepth = config.maxDepth;
  }

  /**
   * Check if a request at the given depth/trace is allowed.
   * @param {number} depth - Current AI depth
   * @param {string} traceId - Causal chain trace ID
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canProceed(depth, traceId) {
    if (depth > this._maxDepth) {
      return { allowed: false, reason: `Max AI depth (${this._maxDepth}) exceeded at depth ${depth}` };
    }

    if (traceId) {
      const count = (this._activeTraces.get(traceId) || 0) + 1;
      if (count > this._maxDepth) {
        return { allowed: false, reason: `Causal chain '${traceId}' looped ${count} times (max ${this._maxDepth})` };
      }
    }

    return { allowed: true };
  }

  /**
   * Record that a trace is being processed.
   */
  enter(traceId) {
    if (!traceId) return;
    const count = (this._activeTraces.get(traceId) || 0) + 1;
    this._activeTraces.set(traceId, count);

    this._traceLog.push({ traceId, count, timestamp: Date.now() });
    if (this._traceLog.length > this._maxTraceLog) {
      this._traceLog.shift();
    }
  }

  /**
   * Record that a trace finished processing.
   */
  exit(traceId) {
    if (!traceId) return;
    const count = (this._activeTraces.get(traceId) || 0) - 1;
    if (count <= 0) this._activeTraces.delete(traceId);
    else this._activeTraces.set(traceId, count);
  }

  /**
   * Generate a new trace ID.
   */
  createTraceId() {
    return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getTraces() {
    return [...this._traceLog];
  }

  getStats() {
    return {
      maxDepth: this._maxDepth,
      activeTraces: this._activeTraces.size,
      traceLogSize: this._traceLog.length,
    };
  }
}

// ─── Main Permissions Class ──────────────────────────────────────

export class WuAIPermissions {
  constructor(config = {}) {
    this._permissions = { ...DEFAULT_PERMISSIONS };
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.loopProtection = new LoopProtection(config.loopProtection);
    this._allowedDomains = config.allowedDomains || [];

    if (config.permissions) {
      this.configure(config.permissions);
    }
  }

  // ── Permission checks ──

  configure(permissions) {
    Object.assign(this._permissions, permissions);

    // HARD BLOCK: never allow direct API key in production
    if (this._isProduction() && this._permissions.allowDirectKey) {
      logger.wuWarn('[wu-ai] allowDirectKey FORCED to false in production');
      this._permissions.allowDirectKey = false;
    }
  }

  check(permission) {
    return this._permissions[permission] === true;
  }

  getPermissions() {
    return { ...this._permissions };
  }

  // ── Domain whitelist for action fetch ──

  setAllowedDomains(domains) {
    this._allowedDomains = domains;
  }

  isDomainAllowed(url) {
    if (this._allowedDomains.length === 0) return true;
    try {
      const hostname = new URL(url).hostname;
      return this._allowedDomains.some(pattern => {
        if (pattern.startsWith('*.')) {
          const suffix = pattern.slice(2);
          return hostname === suffix || hostname.endsWith('.' + suffix);
        }
        return hostname === pattern;
      });
    } catch {
      return false;
    }
  }

  // ── Full pre-flight check ──

  /**
   * Run all checks before sending an AI request.
   * @param {{ namespace?: string, depth?: number, traceId?: string }} meta
   * @returns {{ allowed: boolean, reason?: string }}
   */
  preflight(meta = {}) {
    // 1. Circuit breaker
    const cb = this.circuitBreaker.canPass();
    if (!cb.allowed) return cb;

    // 2. Rate limiter
    const rl = this.rateLimiter.canSend(meta.namespace);
    if (!rl.allowed) return rl;

    // 3. Loop protection
    const lp = this.loopProtection.canProceed(meta.depth || 0, meta.traceId);
    if (!lp.allowed) return lp;

    return { allowed: true };
  }

  // ── Stats ──

  getStats() {
    return {
      permissions: { ...this._permissions },
      rateLimiter: this.rateLimiter.getStats(),
      circuitBreaker: this.circuitBreaker.getStats(),
      loopProtection: this.loopProtection.getStats(),
      allowedDomains: [...this._allowedDomains],
    };
  }

  // ── Private ──

  _isProduction() {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return true;
    if (typeof window !== 'undefined') {
      const h = window.location?.hostname || '';
      return h !== 'localhost' && h !== '127.0.0.1' && h !== '0.0.0.0' && !h.endsWith('.local');
    }
    return false;
  }
}
