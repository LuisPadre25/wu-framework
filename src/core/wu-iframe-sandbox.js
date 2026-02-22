/**
 * WU-IFRAME-SANDBOX: Real JS isolation using hidden iframes.
 *
 * Architecture:
 * ┌── Main Window ────────────────────────────────┐
 * │  ┌── Shadow DOM Container ──────────────────┐ │
 * │  │  App renders here (CSS isolated)          │ │
 * │  └──────────────────────────────────────────┘ │
 * │  ┌── Hidden iframe ────────────────────────┐  │
 * │  │  import() runs here (REAL modules)       │  │
 * │  │  window = iframe.contentWindow (ISOLATED)│  │
 * │  │  document patched → Shadow DOM           │  │
 * │  └────────────────────────────────────────-─┘  │
 * └───────────────────────────────────────────────┘
 *
 * Why iframe?
 * - import() is REAL → tree shaking, source maps, HMR all work
 * - iframe has its own window → globals are isolated
 * - Destroying iframe kills all timers/listeners at once
 *
 * How it works:
 * 1. Create hidden iframe with <base href="appUrl"> for URL resolution
 * 2. Patch iframe's document: createElement → main document (no ownerDocument issues),
 *    querySelector/body → Shadow DOM container
 * 3. Track timers for guaranteed cleanup (some browsers don't kill iframe timers)
 * 4. import() the app module inside iframe → runs in isolated context
 * 5. App calls wu.define() → lifecycle registered on parent's WuCore
 * 6. On unmount: destroy iframe = nuclear cleanup
 *
 * Fallback:
 * If import() fails (CORS, module errors), wu-core falls back to eval mode
 * (fetch HTML + parse + execute with(proxy)).
 */

import { logger } from './wu-logger.js';

export class WuIframeSandbox {
  constructor(appName) {
    this.appName = appName;
    this.iframe = null;
    this._active = false;

    // Side-effect tracking for guaranteed cleanup
    this._timers = new Set();
    this._intervals = new Set();
    this._rafs = new Set();
    this._listeners = [];
  }

  /**
   * Create and activate the iframe sandbox.
   *
   * @param {string} appUrl - App's base URL (for <base href> and relative imports)
   * @param {HTMLElement} shadowContainer - Shadow DOM container for DOM redirection
   * @param {ShadowRoot|null} shadowRoot - Shadow root for query scoping
   * @returns {Window} The iframe's contentWindow (isolated execution context)
   */
  activate(appUrl, shadowContainer, shadowRoot) {
    if (this._active) return this.iframe.contentWindow;

    // 1. Create hidden iframe
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-wu-sandbox', this.appName);
    iframe.style.cssText = 'display:none !important;position:absolute;width:0;height:0;border:0;';

    // Must be in DOM before accessing contentWindow
    document.body.appendChild(iframe);
    this.iframe = iframe;

    // 2. Write base HTML with <base href> pointing to app URL.
    //    This makes relative URL resolution work for fetch(), CSS url(), etc.
    //    import() of full URLs works regardless of base.
    const baseUrl = appUrl.replace(/\/$/, '');
    const iframeWin = iframe.contentWindow;
    const iframeDoc = iframeWin.document;

    iframeDoc.open();
    iframeDoc.write(
      `<!DOCTYPE html><html><head><base href="${baseUrl}/"></head><body></body></html>`
    );
    iframeDoc.close();

    // 3. Make wu available inside iframe for wu.define()
    iframeWin.wu = window.wu;

    // 4. Patch document: redirect DOM operations to Shadow DOM
    this._patchDocument(iframeWin, shadowContainer, shadowRoot);

    // 5. Track timers for guaranteed cleanup
    this._patchTimers(iframeWin);

    this._active = true;
    logger.wuDebug(`[IframeSandbox] Activated for ${this.appName} (base: ${baseUrl})`);
    return iframeWin;
  }

  /**
   * Import an ES module inside the iframe via real import().
   * Preserves tree shaking, source maps, and Vite HMR.
   *
   * @param {string} url - Full module URL to import
   * @param {number} [timeout=30000] - Max wait time in ms
   * @returns {Promise<void>}
   */
  importModule(url, timeout = 30000) {
    if (!this._active) {
      throw new Error(`[IframeSandbox] Not active for ${this.appName}`);
    }

    return new Promise((resolve, reject) => {
      const channelId = `wu_${this.appName}_${Date.now()}`;

      // Listen for import completion via postMessage
      const onMessage = (event) => {
        if (event.data?.channelId !== channelId) return;
        cleanup();
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve();
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(
          `[IframeSandbox] import() timed out for ${this.appName}: ${url}`
        ));
      }, timeout);

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
      };

      window.addEventListener('message', onMessage);

      // Inject module script into iframe
      const iframeDoc = this.iframe.contentWindow.document;
      const script = iframeDoc.createElement('script');
      script.type = 'module';
      script.textContent =
        `import("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` +
        `.then(() => parent.postMessage({ channelId: "${channelId}", success: true }, '*'))` +
        `.catch(e => parent.postMessage({ channelId: "${channelId}", error: e.message || String(e) }, '*'));`;

      iframeDoc.head.appendChild(script);
      logger.wuDebug(`[IframeSandbox] Importing module: ${url}`);
    });
  }

  /**
   * Patch the iframe's document to redirect DOM operations.
   *
   * Critical patches:
   * - createElement/createTextNode → main document (avoids ownerDocument mismatch)
   *   React/Vue create nodes and append to Shadow DOM container.
   *   Nodes must belong to the main document to avoid cross-document adoption issues.
   *
   * - querySelector/body → Shadow DOM container
   *   Libraries that query the document will find app elements in the Shadow DOM.
   *
   * - addEventListener → tracked for cleanup
   */
  _patchDocument(iframeWin, shadowContainer, shadowRoot) {
    const iframeDoc = iframeWin.document;
    const queryTarget = shadowRoot || shadowContainer;
    const mainDoc = document; // parent document

    // --- Node creation: use main document to avoid ownerDocument mismatch ---
    // React uses container.ownerDocument.createElement() internally,
    // but other code might use document.createElement() directly.
    // By redirecting to main document, all nodes belong to the same document tree.
    iframeDoc.createElement = (tag, options) => mainDoc.createElement(tag, options);
    iframeDoc.createElementNS = (ns, tag, options) => mainDoc.createElementNS(ns, tag, options);
    iframeDoc.createTextNode = (text) => mainDoc.createTextNode(text);
    iframeDoc.createComment = (text) => mainDoc.createComment(text);
    iframeDoc.createDocumentFragment = () => mainDoc.createDocumentFragment();

    // --- DOM queries: redirect to Shadow DOM ---
    iframeDoc.querySelector = (sel) => queryTarget.querySelector(sel);
    iframeDoc.querySelectorAll = (sel) => queryTarget.querySelectorAll(sel);
    iframeDoc.getElementById = (id) => queryTarget.querySelector(`#${id}`);
    iframeDoc.getElementsByClassName = (cls) => queryTarget.querySelectorAll(`.${cls}`);
    iframeDoc.getElementsByTagName = (tag) => queryTarget.querySelectorAll(tag);

    // --- document.body → shadow container ---
    // Frameworks that append to document.body (portals, modals) will target the Shadow DOM.
    try {
      Object.defineProperty(iframeDoc, 'body', {
        get: () => shadowContainer,
        configurable: true
      });
    } catch {
      // Some environments don't allow redefining body — not critical
      logger.wuDebug('[IframeSandbox] Could not redefine document.body');
    }

    // --- document.addEventListener: track for cleanup ---
    const origDocAdd = iframeDoc.addEventListener.bind(iframeDoc);
    const origDocRemove = iframeDoc.removeEventListener.bind(iframeDoc);

    iframeDoc.addEventListener = (event, handler, options) => {
      this._listeners.push({ target: iframeDoc, event, handler, options });
      origDocAdd(event, handler, options);
    };

    iframeDoc.removeEventListener = (event, handler, options) => {
      this._listeners = this._listeners.filter(
        l => !(l.target === iframeDoc && l.event === event && l.handler === handler)
      );
      origDocRemove(event, handler, options);
    };

    logger.wuDebug(`[IframeSandbox] Document patched for ${this.appName}`);
  }

  /**
   * Patch timers in the iframe for guaranteed cleanup.
   * Some browsers don't fully kill timers when an iframe is removed.
   * We track all IDs and clear them explicitly on destroy.
   */
  _patchTimers(iframeWin) {
    const origSetTimeout = iframeWin.setTimeout.bind(iframeWin);
    const origClearTimeout = iframeWin.clearTimeout.bind(iframeWin);
    const origSetInterval = iframeWin.setInterval.bind(iframeWin);
    const origClearInterval = iframeWin.clearInterval.bind(iframeWin);

    iframeWin.setTimeout = (fn, ms, ...args) => {
      const id = origSetTimeout((...a) => {
        this._timers.delete(id);
        if (typeof fn === 'function') fn(...a);
      }, ms, ...args);
      this._timers.add(id);
      return id;
    };

    iframeWin.clearTimeout = (id) => {
      this._timers.delete(id);
      origClearTimeout(id);
    };

    iframeWin.setInterval = (fn, ms, ...args) => {
      const id = origSetInterval(fn, ms, ...args);
      this._intervals.add(id);
      return id;
    };

    iframeWin.clearInterval = (id) => {
      this._intervals.delete(id);
      origClearInterval(id);
    };

    // requestAnimationFrame may not exist in all iframe contexts
    if (iframeWin.requestAnimationFrame) {
      const origRAF = iframeWin.requestAnimationFrame.bind(iframeWin);
      const origCancelRAF = iframeWin.cancelAnimationFrame.bind(iframeWin);

      iframeWin.requestAnimationFrame = (fn) => {
        const id = origRAF((...a) => {
          this._rafs.delete(id);
          fn(...a);
        });
        this._rafs.add(id);
        return id;
      };

      iframeWin.cancelAnimationFrame = (id) => {
        this._rafs.delete(id);
        origCancelRAF(id);
      };
    }

    logger.wuDebug(`[IframeSandbox] Timer tracking active for ${this.appName}`);
  }

  /**
   * Destroy the iframe and all side effects.
   * Nuclear cleanup: kills everything at once.
   */
  destroy() {
    if (!this._active) return;
    this._active = false;

    // 1. Clear all tracked timers
    for (const id of this._timers) { try { clearTimeout(id); } catch {} }
    for (const id of this._intervals) { try { clearInterval(id); } catch {} }
    for (const id of this._rafs) { try { cancelAnimationFrame(id); } catch {} }
    this._timers.clear();
    this._intervals.clear();
    this._rafs.clear();

    // 2. Remove all tracked event listeners
    for (const { target, event, handler, options } of this._listeners) {
      try { target.removeEventListener(event, handler, options); } catch {}
    }
    this._listeners = [];

    // 3. Wipe and remove iframe
    if (this.iframe) {
      try {
        const doc = this.iframe.contentDocument;
        if (doc) {
          doc.open();
          doc.write('');
          doc.close();
        }
      } catch {
        // Cross-origin or already detached — ignore
      }

      if (this.iframe.parentNode) {
        this.iframe.parentNode.removeChild(this.iframe);
      }
      this.iframe = null;
    }

    logger.wuDebug(`[IframeSandbox] Destroyed for ${this.appName}`);
  }

  /**
   * Check if this sandbox is active.
   * @returns {boolean}
   */
  isActive() {
    return this._active;
  }
}
