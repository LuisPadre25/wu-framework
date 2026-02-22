/**
 * WU-OVERRIDES: Cookie-based URL overrides for QA/testing
 *
 * SECURITY MODEL:
 * - DISABLED in production by default (must opt-in with allowOverrides: true)
 * - Allowlist of trusted domains (only overrides to whitelisted hosts are accepted)
 * - Visual indicator when overrides are active (prevents silent phishing)
 *
 * How it works:
 * 1. QA sets a cookie: wu-override:cart=http://localhost:5173
 * 2. During wu.init(), overrides are parsed from document.cookie
 * 3. The URL for "cart" is replaced ONLY in that browser session
 * 4. Everyone else sees the production URL
 *
 * Cookie format:
 *   wu-override:<appName>=<url>
 *
 * @example
 * // Enable in init (required in production)
 * wu.init({
 *   apps: [...],
 *   overrides: {
 *     enabled: true,
 *     allowedDomains: ['*.company.com', 'localhost', '*.vercel.app'],
 *     showIndicator: true
 *   }
 * });
 *
 * // Programmatic API
 * wu.override('cart', 'http://localhost:5173');
 * wu.removeOverride('cart');
 * wu.getOverrides();
 * wu.clearOverrides();
 */

import { logger } from './wu-logger.js';

const COOKIE_PREFIX = 'wu-override:';

export class WuOverrides {
  constructor(config = {}) {
    // In-memory cache of active overrides (synced with cookies)
    this._overrides = new Map();

    // Security config
    this._allowedDomains = config.allowedDomains || [];
    this._showIndicator = config.showIndicator ?? true;
    this._indicatorElement = null;

    // Determine enabled state:
    // - If explicitly passed → use that value (respect user intent)
    // - If not passed → auto-detect from environment
    if (config.enabled !== undefined) {
      this._enabled = config.enabled;
    } else {
      this._enabled = this._isDevEnvironment();
    }

    // Parse existing cookies on construction (only if enabled)
    if (this._enabled) {
      this._parseFromCookies();
    }
  }

  // ─── Security: Environment Detection ─────────────────────────

  /**
   * Detect if we're in a development environment.
   * Overrides are auto-enabled in dev, disabled in production.
   */
  _isDevEnvironment() {
    if (typeof window === 'undefined') return false;

    const hostname = window.location?.hostname || '';
    const port = window.location?.port || '';

    // localhost, 127.0.0.1, or non-standard ports = development
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      (port !== '' && port !== '80' && port !== '443')
    );
  }

  // ─── Security: Domain Allowlist ──────────────────────────────

  /**
   * Check if a URL's domain is in the allowlist.
   * If no allowlist is configured, all valid URLs are accepted (dev-mode behavior).
   * If an allowlist IS configured, only matching domains pass.
   *
   * @param {string} url
   * @returns {boolean}
   */
  _isDomainAllowed(url) {
    // No allowlist = allow everything (but only if overrides are enabled)
    if (this._allowedDomains.length === 0) return true;

    const hostname = this._extractHostname(url);
    if (!hostname) return false;

    for (const pattern of this._allowedDomains) {
      if (this._matchDomain(hostname, pattern)) return true;
    }

    return false;
  }

  /**
   * Extract hostname from a URL string.
   */
  _extractHostname(url) {
    try {
      // Handle localhost:PORT shorthand
      if (/^localhost(:\d+)?/.test(url)) return 'localhost';

      // Handle protocol-relative
      const normalized = url.startsWith('//') ? `https:${url}` : url;
      const parsed = new URL(normalized);
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  /**
   * Match a hostname against a domain pattern.
   * Supports wildcard: *.company.com matches sub.company.com
   *
   * @param {string} hostname - e.g., 'cart.staging.company.com'
   * @param {string} pattern - e.g., '*.company.com' or 'localhost'
   * @returns {boolean}
   */
  _matchDomain(hostname, pattern) {
    // Exact match
    if (hostname === pattern) return true;

    // Wildcard match: *.company.com
    if (pattern.startsWith('*.')) {
      const suffix = pattern.substring(2); // 'company.com'
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }

    return false;
  }

  // ─── Cookie Parsing ──────────────────────────────────────────

  /**
   * Parse all wu-override cookies from document.cookie.
   * Called automatically on construction and can be called manually to refresh.
   *
   * @returns {Map<string, string>} Map of appName → overrideUrl
   */
  _parseFromCookies() {
    this._overrides.clear();

    if (typeof document === 'undefined') return this._overrides;

    if (!this._enabled) {
      logger.wuDebug('[WuOverrides] Overrides disabled — skipping cookie parse');
      return this._overrides;
    }

    const cookies = document.cookie;
    if (!cookies) return this._overrides;

    // Split cookies and find wu-override:* entries
    const pairs = cookies.split(';');

    for (const pair of pairs) {
      const trimmed = pair.trim();

      if (!trimmed.startsWith(COOKIE_PREFIX)) continue;

      // wu-override:cart=http://localhost:5173
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const appName = trimmed.substring(COOKIE_PREFIX.length, eqIndex).trim();
      const url = trimmed.substring(eqIndex + 1).trim();

      if (!appName || !url) continue;

      // Validate URL format
      if (!this._isValidUrl(url)) {
        logger.wuWarn(`[WuOverrides] Invalid override URL for "${appName}": ${url}`);
        continue;
      }

      // Validate domain is allowed
      if (!this._isDomainAllowed(url)) {
        logger.wuWarn(
          `[WuOverrides] BLOCKED: "${appName}" override to "${url}" — ` +
          `domain not in allowedDomains. ` +
          `Allowed: [${this._allowedDomains.join(', ')}]`
        );
        continue;
      }

      this._overrides.set(appName, url);
      logger.wuDebug(`[WuOverrides] Parsed override: ${appName} → ${url}`);
    }

    if (this._overrides.size > 0) {
      logger.wuInfo(
        `[WuOverrides] ${this._overrides.size} active override(s): ` +
        [...this._overrides.keys()].join(', ')
      );
    }

    return this._overrides;
  }

  // ─── Apply Overrides ─────────────────────────────────────────

  /**
   * Apply overrides to an array of app configs.
   * Mutates the url field of matching apps.
   * Called by WuCore during init, before registerApp.
   *
   * @param {Array<{name: string, url: string}>} apps - App configs to process
   * @returns {Array<{name: string, url: string, _originalUrl?: string}>} Same array, mutated
   */
  applyToApps(apps) {
    if (!this._enabled || this._overrides.size === 0) return apps;

    for (const app of apps) {
      const overrideUrl = this._overrides.get(app.name);
      if (overrideUrl) {
        app._originalUrl = app.url;
        app.url = overrideUrl;
        logger.wuInfo(
          `[WuOverrides] "${app.name}" overridden: ${app._originalUrl} → ${overrideUrl}`
        );
      }
    }

    // Show visual indicator if overrides were applied
    if (this._showIndicator && this._overrides.size > 0) {
      this._showOverrideIndicator();
    }

    return apps;
  }

  /**
   * Get the override URL for a specific app, or null if none.
   *
   * @param {string} appName
   * @returns {string|null}
   */
  getOverrideFor(appName) {
    return this._overrides.get(appName) || null;
  }

  // ─── Programmatic API ────────────────────────────────────────

  /**
   * Set an override for an app. Writes a cookie and updates in-memory cache.
   *
   * @param {string} appName - App to override
   * @param {string} url - Override URL (e.g., 'http://localhost:5173')
   * @param {Object} [options]
   * @param {number} [options.maxAge=86400] - Cookie max-age in seconds (default: 24h)
   * @param {string} [options.path='/'] - Cookie path
   */
  set(appName, url, options = {}) {
    if (!appName || !url) {
      throw new Error('[WuOverrides] appName and url are required');
    }

    if (!this._enabled) {
      throw new Error(
        '[WuOverrides] Overrides are disabled in this environment. ' +
        'Enable with wu.init({ overrides: { enabled: true } })'
      );
    }

    if (!this._isValidUrl(url)) {
      throw new Error(`[WuOverrides] Invalid URL: ${url}`);
    }

    if (!this._isDomainAllowed(url)) {
      throw new Error(
        `[WuOverrides] Domain not allowed: "${this._extractHostname(url)}". ` +
        `Allowed: [${this._allowedDomains.join(', ')}]`
      );
    }

    const maxAge = options.maxAge ?? 86400; // 24 hours default
    const path = options.path ?? '/';

    // Set cookie
    if (typeof document !== 'undefined') {
      document.cookie =
        `${COOKIE_PREFIX}${appName}=${url}; path=${path}; max-age=${maxAge}; SameSite=Lax`;
    }

    // Update in-memory cache
    this._overrides.set(appName, url);

    // Update visual indicator
    if (this._showIndicator) {
      this._showOverrideIndicator();
    }

    logger.wuInfo(`[WuOverrides] Override set: ${appName} → ${url} (expires in ${maxAge}s)`);
  }

  /**
   * Remove an override for a specific app.
   *
   * @param {string} appName - App to remove override for
   */
  remove(appName) {
    // Delete cookie by setting max-age=0
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_PREFIX}${appName}=; path=/; max-age=0`;
    }

    this._overrides.delete(appName);

    // Update or remove indicator
    if (this._showIndicator) {
      if (this._overrides.size === 0) {
        this._removeOverrideIndicator();
      } else {
        this._showOverrideIndicator();
      }
    }

    logger.wuInfo(`[WuOverrides] Override removed: ${appName}`);
  }

  /**
   * Remove all overrides.
   */
  clearAll() {
    for (const appName of [...this._overrides.keys()]) {
      this.remove(appName);
    }

    this._removeOverrideIndicator();

    logger.wuInfo('[WuOverrides] All overrides cleared');
  }

  /**
   * Get all active overrides as a plain object.
   *
   * @returns {Object} { appName: url, ... }
   */
  getAll() {
    return Object.fromEntries(this._overrides);
  }

  /**
   * Check if any overrides are active.
   *
   * @returns {boolean}
   */
  hasOverrides() {
    return this._overrides.size > 0;
  }

  /**
   * Check if overrides are enabled in this environment.
   *
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Configure the override system.
   * Called by WuCore during init with config.overrides.
   *
   * @param {Object} config
   * @param {boolean} [config.enabled]
   * @param {string[]} [config.allowedDomains]
   * @param {boolean} [config.showIndicator]
   */
  configure(config = {}) {
    if (config.enabled !== undefined) {
      this._enabled = config.enabled;
    }
    if (config.allowedDomains) {
      this._allowedDomains = config.allowedDomains;
    }
    if (config.showIndicator !== undefined) {
      this._showIndicator = config.showIndicator;
    }

    // Re-parse cookies with new config
    if (this._enabled) {
      this._parseFromCookies();
    }
  }

  /**
   * Refresh overrides by re-parsing cookies.
   * Useful if cookies were modified externally (DevTools, other tabs).
   */
  refresh() {
    this._parseFromCookies();
  }

  // ─── Visual Indicator (anti-phishing) ────────────────────────

  /**
   * Show a fixed banner when overrides are active.
   * This prevents silent phishing — the user ALWAYS sees when
   * microfrontends are being loaded from non-standard URLs.
   */
  _showOverrideIndicator() {
    if (typeof document === 'undefined') return;

    // Remove existing indicator first
    this._removeOverrideIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'wu-override-indicator';

    const overrideList = [...this._overrides.entries()]
      .map(([name, url]) => `${name} → ${url}`)
      .join(' | ');

    indicator.textContent = `WU OVERRIDE ACTIVE: ${overrideList}`;

    indicator.style.cssText = [
      'position: fixed',
      'bottom: 0',
      'left: 0',
      'right: 0',
      'z-index: 2147483647',
      'background: #f59e0b',
      'color: #000',
      'font-family: monospace',
      'font-size: 12px',
      'font-weight: bold',
      'padding: 6px 12px',
      'text-align: center',
      'cursor: pointer',
      'user-select: none',
      'box-shadow: 0 -2px 8px rgba(0,0,0,0.2)'
    ].join(';');

    // Click to dismiss (but override stays active)
    indicator.addEventListener('click', () => {
      indicator.style.display = 'none';
    });

    // Double-click to clear all overrides
    indicator.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.clearAll();
    });

    indicator.title = 'Click to hide | Double-click to clear all overrides';

    document.body.appendChild(indicator);
    this._indicatorElement = indicator;
  }

  /**
   * Remove the visual indicator.
   */
  _removeOverrideIndicator() {
    if (this._indicatorElement) {
      this._indicatorElement.remove();
      this._indicatorElement = null;
    }
    // Also remove by ID in case element reference was lost
    if (typeof document !== 'undefined') {
      const existing = document.getElementById('wu-override-indicator');
      if (existing) existing.remove();
    }
  }

  // ─── Validation ──────────────────────────────────────────────

  _isValidUrl(url) {
    // Accept http://, https://, and // protocol-relative
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
      return true;
    }
    // Accept localhost shorthand like localhost:3000
    if (/^localhost(:\d+)?/.test(url)) {
      return true;
    }
    return false;
  }

  // ─── Stats ───────────────────────────────────────────────────

  getStats() {
    return {
      enabled: this._enabled,
      activeOverrides: this._overrides.size,
      overrides: this.getAll(),
      allowedDomains: this._allowedDomains,
      showIndicator: this._showIndicator,
      environment: this._isDevEnvironment() ? 'development' : 'production'
    };
  }
}
