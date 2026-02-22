import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIPermissions } from '../../src/ai/wu-ai-permissions.js';

describe('WuAIPermissions', () => {
  let perms;

  beforeEach(() => {
    perms = new WuAIPermissions();
  });

  // ── Permission Flags ──

  describe('permission flags', () => {
    it('should have sensible defaults', () => {
      expect(perms.check('readStore')).toBe(true);
      expect(perms.check('writeStore')).toBe(false);
      expect(perms.check('emitEvents')).toBe(true);
      expect(perms.check('readDOM')).toBe(false);
      expect(perms.check('modifyDOM')).toBe(false);
      expect(perms.check('executeActions')).toBe(true);
      expect(perms.check('allowDirectKey')).toBe(false);
    });

    it('should allow configuring permissions', () => {
      perms.configure({ writeStore: true, readDOM: true });
      expect(perms.check('writeStore')).toBe(true);
      expect(perms.check('readDOM')).toBe(true);
    });

    it('should return all permissions', () => {
      const all = perms.getPermissions();
      expect(all).toHaveProperty('readStore');
      expect(all).toHaveProperty('writeStore');
    });
  });

  // ── Rate Limiter ──

  describe('rateLimiter', () => {
    it('should allow requests within limits', () => {
      const result = perms.rateLimiter.canSend('test');
      expect(result.allowed).toBe(true);
    });

    it('should block when concurrent limit reached', () => {
      perms.rateLimiter.configure({ maxConcurrent: 1 });
      perms.rateLimiter.recordStart('test');
      const result = perms.rateLimiter.canSend('test');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('concurrent');
    });

    it('should release concurrent slot on recordEnd', () => {
      perms.rateLimiter.configure({ maxConcurrent: 1 });
      perms.rateLimiter.recordStart('test');
      perms.rateLimiter.recordEnd();
      const result = perms.rateLimiter.canSend('test');
      expect(result.allowed).toBe(true);
    });

    it('should block when global rate limit exceeded', () => {
      perms.rateLimiter.configure({ requestsPerMinute: 2, maxConcurrent: 100 });
      perms.rateLimiter.recordStart('a');
      perms.rateLimiter.recordEnd();
      perms.rateLimiter.recordStart('b');
      perms.rateLimiter.recordEnd();
      const result = perms.rateLimiter.canSend('c');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global rate limit');
    });

    it('should block when namespace rate limit exceeded', () => {
      perms.rateLimiter.configure({ requestsPerMinutePerNs: 1, requestsPerMinute: 100, maxConcurrent: 100 });
      perms.rateLimiter.recordStart('ns1');
      perms.rateLimiter.recordEnd();
      const result = perms.rateLimiter.canSend('ns1');
      expect(result.allowed).toBe(false);
      // Different namespace should still work
      const result2 = perms.rateLimiter.canSend('ns2');
      expect(result2.allowed).toBe(true);
    });

    it('should return stats', () => {
      const stats = perms.rateLimiter.getStats();
      expect(stats).toHaveProperty('globalRequestsLastMinute');
      expect(stats).toHaveProperty('concurrent');
    });
  });

  // ── Circuit Breaker ──

  describe('circuitBreaker', () => {
    it('should start in CLOSED state', () => {
      expect(perms.circuitBreaker.getState()).toBe('closed');
      expect(perms.circuitBreaker.canPass().allowed).toBe(true);
    });

    it('should trip to OPEN after max failures', () => {
      perms.circuitBreaker.configure({ maxFailures: 2 });
      perms.circuitBreaker.recordFailure();
      perms.circuitBreaker.recordFailure();
      expect(perms.circuitBreaker.getState()).toBe('open');
      expect(perms.circuitBreaker.canPass().allowed).toBe(false);
    });

    it('should recover to CLOSED after success in HALF-OPEN', () => {
      perms.circuitBreaker.configure({ maxFailures: 1, cooldownMs: 0 });
      perms.circuitBreaker.recordFailure();
      expect(perms.circuitBreaker.getState()).toBe('open');

      // After cooldown (0ms), should transition to half-open
      const result = perms.circuitBreaker.canPass();
      expect(result.allowed).toBe(true);
      expect(perms.circuitBreaker.getState()).toBe('half-open');

      // Success in half-open → closed
      perms.circuitBreaker.recordSuccess();
      expect(perms.circuitBreaker.getState()).toBe('closed');
    });

    it('should re-trip on failure in HALF-OPEN', () => {
      perms.circuitBreaker.configure({ maxFailures: 1, cooldownMs: 0 });
      perms.circuitBreaker.recordFailure();
      perms.circuitBreaker.canPass(); // → half-open
      perms.circuitBreaker.recordFailure();
      expect(perms.circuitBreaker.getState()).toBe('open');
    });

    it('should reset on success in CLOSED state', () => {
      perms.circuitBreaker.recordFailure();
      perms.circuitBreaker.recordSuccess();
      expect(perms.circuitBreaker.getStats().failureCount).toBe(0);
    });

    it('should reset completely', () => {
      perms.circuitBreaker.configure({ maxFailures: 1 });
      perms.circuitBreaker.recordFailure();
      perms.circuitBreaker.reset();
      expect(perms.circuitBreaker.getState()).toBe('closed');
    });
  });

  // ── Loop Protection ──

  describe('loopProtection', () => {
    it('should allow requests within depth limit', () => {
      const result = perms.loopProtection.canProceed(1, 'trace1');
      expect(result.allowed).toBe(true);
    });

    it('should block when depth exceeded', () => {
      perms.loopProtection.configure({ maxDepth: 2 });
      const result = perms.loopProtection.canProceed(3, 'trace1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });

    it('should track causal chains', () => {
      perms.loopProtection.configure({ maxDepth: 2 });
      perms.loopProtection.enter('trace1');
      perms.loopProtection.enter('trace1');
      const result = perms.loopProtection.canProceed(1, 'trace1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('looped');
    });

    it('should release on exit', () => {
      perms.loopProtection.configure({ maxDepth: 2 });
      perms.loopProtection.enter('trace1');
      perms.loopProtection.exit('trace1');
      const result = perms.loopProtection.canProceed(1, 'trace1');
      expect(result.allowed).toBe(true);
    });

    it('should generate unique trace IDs', () => {
      const id1 = perms.loopProtection.createTraceId();
      const id2 = perms.loopProtection.createTraceId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^t_/);
    });
  });

  // ── Domain Whitelist ──

  describe('domain whitelist', () => {
    it('should allow all domains when no whitelist', () => {
      expect(perms.isDomainAllowed('https://api.example.com/chat')).toBe(true);
    });

    it('should block non-whitelisted domains', () => {
      perms.setAllowedDomains(['api.mysite.com']);
      expect(perms.isDomainAllowed('https://api.mysite.com/chat')).toBe(true);
      expect(perms.isDomainAllowed('https://evil.com/chat')).toBe(false);
    });

    it('should support wildcard domains', () => {
      perms.setAllowedDomains(['*.mysite.com']);
      expect(perms.isDomainAllowed('https://api.mysite.com/chat')).toBe(true);
      expect(perms.isDomainAllowed('https://mysite.com/chat')).toBe(true);
      expect(perms.isDomainAllowed('https://evil.com/chat')).toBe(false);
    });

    it('should handle invalid URLs', () => {
      perms.setAllowedDomains(['api.mysite.com']);
      expect(perms.isDomainAllowed('not-a-url')).toBe(false);
    });
  });

  // ── Preflight ──

  describe('preflight', () => {
    it('should pass all checks when healthy', () => {
      const result = perms.preflight({ namespace: 'test', depth: 0 });
      expect(result.allowed).toBe(true);
    });

    it('should fail when circuit breaker is open', () => {
      perms.circuitBreaker.configure({ maxFailures: 1 });
      perms.circuitBreaker.recordFailure();
      const result = perms.preflight({});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Circuit breaker');
    });

    it('should fail when depth exceeded', () => {
      perms.loopProtection.configure({ maxDepth: 1 });
      const result = perms.preflight({ depth: 5 });
      expect(result.allowed).toBe(false);
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      const stats = perms.getStats();
      expect(stats).toHaveProperty('permissions');
      expect(stats).toHaveProperty('rateLimiter');
      expect(stats).toHaveProperty('circuitBreaker');
      expect(stats).toHaveProperty('loopProtection');
      expect(stats).toHaveProperty('allowedDomains');
    });
  });
});
