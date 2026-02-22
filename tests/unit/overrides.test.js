/**
 * Tests for WuOverrides — Cookie-based URL overrides with security layers
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WuOverrides } from '../../src/core/wu-overrides.js';

// Helper to set cookies in jsdom
function setCookie(name, value) {
  document.cookie = `${name}=${value}; path=/`;
}

function clearAllCookies() {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const name = cookie.split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
}

describe('WuOverrides', () => {
  let overrides;

  beforeEach(() => {
    clearAllCookies();
    // Force enabled for most tests (jsdom is localhost so auto-enabled anyway)
    overrides = new WuOverrides({ enabled: true });
  });

  afterEach(() => {
    clearAllCookies();
    // Clean up indicator
    const indicator = document.getElementById('wu-override-indicator');
    if (indicator) indicator.remove();
  });

  // ─── Cookie Parsing ──────────────────────────────────────

  describe('cookie parsing', () => {
    it('should parse wu-override cookies', () => {
      setCookie('wu-override:cart', 'http://localhost:5173');
      overrides.refresh();

      expect(overrides.getAll()).toEqual({
        cart: 'http://localhost:5173'
      });
    });

    it('should parse multiple override cookies', () => {
      setCookie('wu-override:cart', 'http://localhost:5173');
      setCookie('wu-override:header', 'http://localhost:4000');
      overrides.refresh();

      const all = overrides.getAll();
      expect(all.cart).toBe('http://localhost:5173');
      expect(all.header).toBe('http://localhost:4000');
    });

    it('should ignore non-wu cookies', () => {
      setCookie('session_id', 'abc123');
      setCookie('theme', 'dark');
      setCookie('wu-override:cart', 'http://localhost:5173');
      overrides.refresh();

      const all = overrides.getAll();
      expect(Object.keys(all)).toEqual(['cart']);
    });

    it('should handle empty cookies', () => {
      clearAllCookies();
      overrides.refresh();

      expect(overrides.getAll()).toEqual({});
      expect(overrides.hasOverrides()).toBe(false);
    });

    it('should reject invalid URLs', () => {
      setCookie('wu-override:cart', 'not-a-url');
      overrides.refresh();

      expect(overrides.getOverrideFor('cart')).toBeNull();
    });

    it('should accept https URLs', () => {
      setCookie('wu-override:cart', 'https://preview-abc123.vercel.app');
      overrides.refresh();

      expect(overrides.getOverrideFor('cart')).toBe('https://preview-abc123.vercel.app');
    });

    it('should accept protocol-relative URLs', () => {
      setCookie('wu-override:cart', '//cdn.example.com/cart');
      overrides.refresh();

      expect(overrides.getOverrideFor('cart')).toBe('//cdn.example.com/cart');
    });

    it('should accept localhost shorthand', () => {
      setCookie('wu-override:cart', 'localhost:3000');
      overrides.refresh();

      expect(overrides.getOverrideFor('cart')).toBe('localhost:3000');
    });
  });

  // ─── Security: Disabled by Default in Production ─────────

  describe('production security', () => {
    it('should be disabled when not in dev environment and not explicitly enabled', () => {
      const prodOverrides = new WuOverrides({ enabled: false });
      expect(prodOverrides.isEnabled()).toBe(false);
    });

    it('should not parse cookies when disabled', () => {
      const prodOverrides = new WuOverrides({ enabled: false });
      setCookie('wu-override:cart', 'http://localhost:5173');
      prodOverrides.refresh();

      expect(prodOverrides.getOverrideFor('cart')).toBeNull();
    });

    it('should throw when trying to set override while disabled', () => {
      const prodOverrides = new WuOverrides({ enabled: false });

      expect(() => {
        prodOverrides.set('cart', 'http://localhost:5173');
      }).toThrow('disabled');
    });

    it('should work when explicitly enabled', () => {
      const enabledOverrides = new WuOverrides({ enabled: true });
      enabledOverrides.set('cart', 'http://localhost:5173');

      expect(enabledOverrides.getOverrideFor('cart')).toBe('http://localhost:5173');
    });

    it('should auto-enable in development (localhost)', () => {
      // jsdom defaults to localhost, so auto-detection should enable
      const autoOverrides = new WuOverrides();
      expect(autoOverrides.isEnabled()).toBe(true);
    });
  });

  // ─── Security: Domain Allowlist ──────────────────────────

  describe('domain allowlist', () => {
    it('should allow all domains when no allowlist is configured', () => {
      overrides.set('cart', 'http://evil.com:3000');
      expect(overrides.getOverrideFor('cart')).toBe('http://evil.com:3000');
    });

    it('should block domains not in allowlist', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['*.company.com', 'localhost']
      });

      expect(() => {
        restricted.set('cart', 'http://evil.com/fake-cart');
      }).toThrow('Domain not allowed');
    });

    it('should allow exact domain matches', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['localhost', 'staging.company.com']
      });

      restricted.set('cart', 'http://localhost:5173');
      expect(restricted.getOverrideFor('cart')).toBe('http://localhost:5173');

      restricted.set('header', 'https://staging.company.com');
      expect(restricted.getOverrideFor('header')).toBe('https://staging.company.com');
    });

    it('should support wildcard domain patterns', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['*.company.com']
      });

      restricted.set('cart', 'https://cart.staging.company.com');
      expect(restricted.getOverrideFor('cart')).toBe('https://cart.staging.company.com');

      restricted.set('header', 'https://preview-123.company.com');
      expect(restricted.getOverrideFor('header')).toBe('https://preview-123.company.com');
    });

    it('should block wildcard non-matching domains', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['*.company.com']
      });

      expect(() => {
        restricted.set('cart', 'https://evil.com');
      }).toThrow('Domain not allowed');
    });

    it('should block override cookies from untrusted domains', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['localhost']
      });

      setCookie('wu-override:cart', 'https://evil.com/phishing');
      restricted.refresh();

      // Cookie was parsed but URL was blocked by allowlist
      expect(restricted.getOverrideFor('cart')).toBeNull();
    });

    it('should allow *.vercel.app pattern', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['*.vercel.app', 'localhost']
      });

      restricted.set('cart', 'https://cart-pr-247.vercel.app');
      expect(restricted.getOverrideFor('cart')).toBe('https://cart-pr-247.vercel.app');
    });
  });

  // ─── Domain Matching ─────────────────────────────────────

  describe('domain matching', () => {
    it('should extract hostname from http URL', () => {
      expect(overrides._extractHostname('http://example.com:3000/path')).toBe('example.com');
    });

    it('should extract hostname from https URL', () => {
      expect(overrides._extractHostname('https://sub.domain.com')).toBe('sub.domain.com');
    });

    it('should extract hostname from protocol-relative URL', () => {
      expect(overrides._extractHostname('//cdn.example.com/path')).toBe('cdn.example.com');
    });

    it('should extract localhost from shorthand', () => {
      expect(overrides._extractHostname('localhost:3000')).toBe('localhost');
      expect(overrides._extractHostname('localhost')).toBe('localhost');
    });

    it('should match exact domains', () => {
      expect(overrides._matchDomain('localhost', 'localhost')).toBe(true);
      expect(overrides._matchDomain('example.com', 'example.com')).toBe(true);
      expect(overrides._matchDomain('example.com', 'other.com')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(overrides._matchDomain('sub.company.com', '*.company.com')).toBe(true);
      expect(overrides._matchDomain('deep.sub.company.com', '*.company.com')).toBe(true);
      expect(overrides._matchDomain('company.com', '*.company.com')).toBe(true);
      expect(overrides._matchDomain('evil.com', '*.company.com')).toBe(false);
    });
  });

  // ─── Apply to Apps ───────────────────────────────────────

  describe('applyToApps', () => {
    it('should override matching app URLs', () => {
      setCookie('wu-override:cart', 'http://localhost:5173');
      overrides.refresh();

      const apps = [
        { name: 'header', url: 'https://header.prod.com' },
        { name: 'cart', url: 'https://cart.prod.com' },
      ];

      overrides.applyToApps(apps);

      expect(apps[0].url).toBe('https://header.prod.com');
      expect(apps[1].url).toBe('http://localhost:5173');
      expect(apps[1]._originalUrl).toBe('https://cart.prod.com');
    });

    it('should not modify apps without overrides', () => {
      const apps = [
        { name: 'header', url: 'https://header.prod.com' },
        { name: 'cart', url: 'https://cart.prod.com' },
      ];

      overrides.applyToApps(apps);

      expect(apps[0].url).toBe('https://header.prod.com');
      expect(apps[1].url).toBe('https://cart.prod.com');
    });

    it('should not apply when disabled', () => {
      const disabled = new WuOverrides({ enabled: false });
      setCookie('wu-override:cart', 'http://localhost:5173');

      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      disabled.applyToApps(apps);

      expect(apps[0].url).toBe('https://cart.prod.com');
    });

    it('should handle multiple overrides simultaneously', () => {
      setCookie('wu-override:cart', 'http://localhost:5173');
      setCookie('wu-override:header', 'http://localhost:4000');
      overrides.refresh();

      const apps = [
        { name: 'header', url: 'https://header.prod.com' },
        { name: 'cart', url: 'https://cart.prod.com' },
        { name: 'sidebar', url: 'https://sidebar.prod.com' },
      ];

      overrides.applyToApps(apps);

      expect(apps[0].url).toBe('http://localhost:4000');
      expect(apps[1].url).toBe('http://localhost:5173');
      expect(apps[2].url).toBe('https://sidebar.prod.com');
    });
  });

  // ─── Visual Indicator ────────────────────────────────────

  describe('visual indicator', () => {
    it('should show indicator when overrides are applied', () => {
      overrides.set('cart', 'http://localhost:5173');

      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      overrides.applyToApps(apps);

      const indicator = document.getElementById('wu-override-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator.textContent).toContain('cart');
      expect(indicator.textContent).toContain('localhost:5173');
    });

    it('should remove indicator when all overrides are cleared', () => {
      overrides.set('cart', 'http://localhost:5173');

      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      overrides.applyToApps(apps);
      expect(document.getElementById('wu-override-indicator')).not.toBeNull();

      overrides.clearAll();
      expect(document.getElementById('wu-override-indicator')).toBeNull();
    });

    it('should not show indicator when showIndicator is false', () => {
      const quiet = new WuOverrides({ enabled: true, showIndicator: false });
      quiet.set('cart', 'http://localhost:5173');

      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      quiet.applyToApps(apps);

      expect(document.getElementById('wu-override-indicator')).toBeNull();
    });

    it('should hide on click', () => {
      overrides.set('cart', 'http://localhost:5173');
      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      overrides.applyToApps(apps);

      const indicator = document.getElementById('wu-override-indicator');
      indicator.click();

      expect(indicator.style.display).toBe('none');
    });

    it('should update indicator content when overrides change', () => {
      overrides.set('cart', 'http://localhost:5173');
      const apps = [{ name: 'cart', url: 'https://cart.prod.com' }];
      overrides.applyToApps(apps);

      overrides.set('header', 'http://localhost:4000');

      const indicator = document.getElementById('wu-override-indicator');
      expect(indicator.textContent).toContain('header');
    });
  });

  // ─── Programmatic API ────────────────────────────────────

  describe('programmatic set/remove', () => {
    it('should set an override', () => {
      overrides.set('cart', 'http://localhost:5173');

      expect(overrides.getOverrideFor('cart')).toBe('http://localhost:5173');
      expect(overrides.hasOverrides()).toBe(true);
    });

    it('should write cookie when setting override', () => {
      overrides.set('cart', 'http://localhost:5173');

      expect(document.cookie).toContain('wu-override:cart=http://localhost:5173');
    });

    it('should remove an override', () => {
      overrides.set('cart', 'http://localhost:5173');
      overrides.remove('cart');
      expect(overrides.getOverrideFor('cart')).toBeNull();
    });

    it('should clear all overrides', () => {
      overrides.set('cart', 'http://localhost:5173');
      overrides.set('header', 'http://localhost:4000');

      overrides.clearAll();

      expect(overrides.hasOverrides()).toBe(false);
      expect(overrides.getAll()).toEqual({});
    });

    it('should throw on missing appName', () => {
      expect(() => overrides.set('', 'http://localhost:5173')).toThrow();
    });

    it('should throw on missing url', () => {
      expect(() => overrides.set('cart', '')).toThrow();
    });

    it('should throw on invalid url', () => {
      expect(() => overrides.set('cart', 'not-valid')).toThrow('Invalid URL');
    });
  });

  // ─── Configure ───────────────────────────────────────────

  describe('configure', () => {
    it('should enable overrides via configure', () => {
      const o = new WuOverrides({ enabled: false });
      expect(o.isEnabled()).toBe(false);

      o.configure({ enabled: true });
      expect(o.isEnabled()).toBe(true);
    });

    it('should set allowedDomains via configure', () => {
      overrides.configure({
        allowedDomains: ['*.company.com']
      });

      expect(() => {
        overrides.set('cart', 'http://evil.com');
      }).toThrow('Domain not allowed');

      overrides.set('cart', 'https://staging.company.com');
      expect(overrides.getOverrideFor('cart')).toBe('https://staging.company.com');
    });

    it('should re-parse cookies after configure', () => {
      const o = new WuOverrides({ enabled: false });
      setCookie('wu-override:cart', 'http://localhost:5173');

      // Before configure: disabled, no parsing
      expect(o.getOverrideFor('cart')).toBeNull();

      // After configure: enabled, parses cookies
      o.configure({ enabled: true });
      expect(o.getOverrideFor('cart')).toBe('http://localhost:5173');
    });
  });

  // ─── URL Validation ──────────────────────────────────────

  describe('URL validation', () => {
    it('should accept http://', () => {
      expect(overrides._isValidUrl('http://localhost:3000')).toBe(true);
    });

    it('should accept https://', () => {
      expect(overrides._isValidUrl('https://example.com')).toBe(true);
    });

    it('should accept protocol-relative //', () => {
      expect(overrides._isValidUrl('//cdn.example.com')).toBe(true);
    });

    it('should accept localhost shorthand', () => {
      expect(overrides._isValidUrl('localhost:3000')).toBe(true);
      expect(overrides._isValidUrl('localhost')).toBe(true);
    });

    it('should reject random strings', () => {
      expect(overrides._isValidUrl('not-a-url')).toBe(false);
      expect(overrides._isValidUrl('ftp://server')).toBe(false);
      expect(overrides._isValidUrl('')).toBe(false);
    });
  });

  // ─── Stats ───────────────────────────────────────────────

  describe('getStats', () => {
    it('should return full stats', () => {
      overrides.set('cart', 'http://localhost:5173');

      const stats = overrides.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.activeOverrides).toBe(1);
      expect(stats.overrides).toEqual({ cart: 'http://localhost:5173' });
      expect(stats.allowedDomains).toEqual([]);
      expect(stats.showIndicator).toBe(true);
    });

    it('should show allowedDomains in stats', () => {
      const restricted = new WuOverrides({
        enabled: true,
        allowedDomains: ['*.company.com', 'localhost']
      });

      const stats = restricted.getStats();
      expect(stats.allowedDomains).toEqual(['*.company.com', 'localhost']);
    });
  });
});
