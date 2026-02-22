/**
 * WU-AI Browser Primitives
 *
 * Shared browser capabilities used by both wu-ai-browser.js (Paradigm 1/2)
 * and wu-mcp-bridge.js (Paradigm 3). Single source of truth to avoid
 * duplicating interceptors, DOM traversal, and Canvas rendering.
 */

// ── Shared capture buffers (singleton) ──

export const networkLog = [];
export const MAX_NETWORK_LOG = 300;
export const consoleLog = [];
export const MAX_CONSOLE_LOG = 500;

let _interceptorsInstalled = false;

/**
 * Install network + console interceptors (idempotent — only runs once).
 */
export function ensureInterceptors() {
  if (_interceptorsInstalled) return;
  _installNetworkInterceptor();
  _installConsoleInterceptor();
  _interceptorsInstalled = true;
}

/**
 * Build an accessibility tree representation of a DOM element.
 * Traverses into Shadow DOM if present.
 */
export function buildA11yTree(el, depth = 0, maxDepth = 5) {
  if (depth > maxDepth || !el) return '';

  const indent = '  '.repeat(depth);
  const tag = el.tagName?.toLowerCase() || '';
  const role = el.getAttribute?.('role') || '';
  const ariaLabel = el.getAttribute?.('aria-label') || '';
  const text = el.childNodes?.length === 1 && el.childNodes[0].nodeType === 3
    ? el.textContent?.trim().slice(0, 80) : '';

  let line = `${indent}<${tag}`;
  if (el.id) line += ` id="${el.id}"`;
  if (role) line += ` role="${role}"`;
  if (ariaLabel) line += ` aria-label="${ariaLabel}"`;
  if (el.className && typeof el.className === 'string') {
    const cls = el.className.trim().slice(0, 60);
    if (cls) line += ` class="${cls}"`;
  }
  line += '>';
  if (text) line += ` "${text}"`;

  let result = line + '\n';
  const root = el.shadowRoot || el;
  const children = root.children || [];

  for (let i = 0; i < children.length && i < 50; i++) {
    result += buildA11yTree(children[i], depth + 1, maxDepth);
  }
  return result;
}

/**
 * Recursively inline computed styles from source to clone for Canvas rendering.
 */
export function inlineComputedStyles(source, clone) {
  const props = ['color', 'background', 'background-color', 'font-family',
    'font-size', 'font-weight', 'border', 'border-radius', 'padding', 'margin',
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'width', 'height', 'max-width', 'max-height', 'overflow', 'opacity',
    'box-shadow', 'text-align', 'line-height', 'position', 'top', 'left',
    'right', 'bottom', 'z-index', 'transform', 'visibility'];

  try {
    const style = window.getComputedStyle(source);
    for (const prop of props) {
      const val = style.getPropertyValue(prop);
      if (val) clone.style?.setProperty(prop, val);
    }
  } catch (_) { /* skip */ }

  const srcKids = source.children || [];
  const cloneKids = clone.children || [];
  const max = Math.min(srcKids.length, cloneKids.length, 200);
  for (let i = 0; i < max; i++) {
    inlineComputedStyles(srcKids[i], cloneKids[i]);
  }
}

/**
 * Capture a screenshot of a DOM element via Canvas API (SVG foreignObject).
 * @returns {Promise<{ width, height, format, base64, sizeKB } | { error: string }>}
 */
export async function captureScreenshot(selector, quality = 0.8) {
  const target = selector
    ? document.querySelector(selector)
    : document.documentElement;

  if (!target) return { error: `Element not found: ${selector}` };

  const rect = target.getBoundingClientRect();
  const w = Math.ceil(Math.min(rect.width || window.innerWidth, 1920));
  const h = Math.ceil(Math.min(rect.height || window.innerHeight, 1080));

  const clone = target.cloneNode(true);
  inlineComputedStyles(target, clone);

  const serializer = new XMLSerializer();
  const xhtml = serializer.serializeToString(clone);

  const svgStr = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
    '<foreignObject width="100%" height="100%">',
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;">`,
    xhtml,
    '</div>',
    '</foreignObject>',
    '</svg>',
  ].join('');

  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const dataUrl = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });

  if (!dataUrl) return { error: 'Canvas rendering failed' };

  const base64 = dataUrl.split(',')[1];
  return {
    width: w,
    height: h,
    format: 'png',
    base64,
    sizeKB: Math.round((base64.length * 3) / 4 / 1024),
  };
}

/**
 * Click an element by CSS selector or visible text content.
 * @returns {{ clicked, text } | { error }}
 */
export function clickElement(selector, text) {
  let el = null;

  if (selector) {
    el = document.querySelector(selector);
  }

  if (!el && text) {
    const candidates = document.querySelectorAll(
      'button, a, [role="button"], input[type="submit"], input[type="button"], [data-click], label, [onclick]'
    );
    const searchText = text.toLowerCase();
    for (const candidate of candidates) {
      if (candidate.textContent?.trim().toLowerCase().includes(searchText)) {
        el = candidate;
        break;
      }
    }
  }

  if (!el) return { error: `Element not found: ${selector || `text="${text}"`}` };

  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  el.click();

  const tag = el.tagName?.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  return {
    clicked: `${tag}${id}`,
    text: el.textContent?.trim().slice(0, 100) || '',
    rect: el.getBoundingClientRect().toJSON?.() || null,
  };
}

/**
 * Type into an input, textarea, or contenteditable element.
 * Works with React, Vue, Angular, and other frameworks.
 * @returns {{ selector, typed, currentValue, submitted } | { error }}
 */
export function typeIntoElement(selector, text, { clear = false, submit = false } = {}) {
  if (!selector) return { error: 'selector is required' };
  if (text === undefined) return { error: 'text is required' };

  const el = document.querySelector(selector);
  if (!el) return { error: `Element not found: ${selector}` };

  el.focus();

  if (clear) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Use native setter to trigger framework reactivity (React, Vue, etc.)
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set || Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  const newValue = clear ? text : (el.value || '') + text;
  if (nativeSetter) {
    nativeSetter.call(el, newValue);
  } else {
    el.value = newValue;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (submit) {
    const form = el.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } else {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
  }

  return {
    selector,
    typed: text,
    currentValue: el.value?.slice(0, 200),
    submitted: !!submit,
  };
}

/**
 * Filter and return network log entries.
 */
export function getFilteredNetwork(method, status, limit = 30) {
  let filtered = networkLog;
  if (method) {
    filtered = filtered.filter((r) => r.method === method.toUpperCase());
  }
  if (status) {
    if (status === 'error') {
      filtered = filtered.filter((r) => r.status === 0 || r.status >= 400);
    } else {
      filtered = filtered.filter((r) => String(r.status).startsWith(String(status)));
    }
  }
  return {
    requests: filtered.slice(-limit),
    total: networkLog.length,
    showing: Math.min(filtered.length, limit),
  };
}

/**
 * Filter and return console log entries.
 */
export function getFilteredConsole(level, limit = 30) {
  const filtered = level && level !== 'all'
    ? consoleLog.filter((m) => m.level === level)
    : consoleLog;
  return {
    messages: filtered.slice(-limit),
    total: consoleLog.length,
    showing: Math.min(filtered.length, limit),
  };
}

// ── Private: Interceptors ──

function _installNetworkInterceptor() {
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const start = Date.now();
    const req = args[0];
    const url = typeof req === 'string' ? req : req?.url || '';
    const method = (args[1]?.method || req?.method || 'GET').toUpperCase();

    try {
      const response = await originalFetch.apply(window, args);
      const size = parseInt(response.headers?.get('content-length') || '0', 10);
      networkLog.push({
        type: 'fetch', method, url,
        status: response.status, statusText: response.statusText,
        duration: Date.now() - start, size, timestamp: start,
      });
      if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();
      return response;
    } catch (err) {
      networkLog.push({
        type: 'fetch', method, url,
        status: 0, error: err.message,
        duration: Date.now() - start, timestamp: start,
      });
      if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();
      throw err;
    }
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._wuAi = { method: (method || 'GET').toUpperCase(), url: String(url) };
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._wuAi) {
      this._wuAi.start = Date.now();
      this.addEventListener('loadend', () => {
        networkLog.push({
          type: 'xhr', method: this._wuAi.method, url: this._wuAi.url,
          status: this.status, statusText: this.statusText,
          duration: Date.now() - this._wuAi.start,
          size: parseInt(this.getResponseHeader('content-length') || '0', 10),
          timestamp: this._wuAi.start,
        });
        if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();
      });
    }
    return origSend.apply(this, args);
  };
}

function _installConsoleInterceptor() {
  const levels = ['log', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level];
    console[level] = (...args) => {
      consoleLog.push({
        level,
        message: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
        timestamp: Date.now(),
      });
      if (consoleLog.length > MAX_CONSOLE_LOG) consoleLog.shift();
      original.apply(console, args);
    };
  }
}
