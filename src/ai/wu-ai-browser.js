/**
 * WU-AI Browser Actions
 *
 * Registers browser automation tools into wu.ai so any LLM provider
 * (OpenAI, Claude, Gemini, Ollama, etc.) can autonomously see and
 * control the page — no human intervention required.
 *
 * Tools registered:
 *   browser_screenshot  — Capture page/element as PNG (Canvas API)
 *   browser_click       — Click element by selector or visible text
 *   browser_type        — Type into inputs (React/Vue/framework compatible)
 *   browser_snapshot    — Get accessibility tree of the DOM
 *   browser_navigate    — Navigate SPA routes
 *   browser_network     — View captured HTTP requests (fetch + XHR)
 *   browser_console     — View captured console messages
 *   browser_info        — Get page state: apps, store, URL, viewport
 *   browser_select      — Select option in dropdowns
 *   browser_scroll      — Scroll page or element
 *
 * @example
 * // Auto-registered when wu.ai initializes
 * // Any LLM connected via wu.ai.provider can now use these tools:
 * const tools = wu.ai.tools();
 * // → includes browser_screenshot, browser_click, etc.
 */

import {
  ensureInterceptors,
  networkLog,
  consoleLog,
  captureScreenshot,
  buildA11yTree,
  clickElement,
  typeIntoElement,
  getFilteredNetwork,
  getFilteredConsole,
} from './wu-ai-browser-primitives.js';

/**
 * Register all browser automation actions into a WuAI instance.
 *
 * @param {object} ai - The WuAI instance (wu.ai)
 * @param {object} wu - The Wu Framework instance (window.wu)
 */
export function registerBrowserActions(ai, wu) {
  ensureInterceptors();

  // ════════════════════════════════════════════
  // SCREENSHOT — Canvas API (SVG foreignObject)
  // ════════════════════════════════════════════

  ai.action('browser_screenshot', {
    description: 'Take a screenshot of the current page or a specific element. Returns a base64 PNG image. Use this to SEE what the user sees.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to capture. Empty = full visible page.',
        required: false,
      },
    },
    handler: async (params) => captureScreenshot(params.selector),
    permissions: [],
  });

  // ════════════════════════════════════════════
  // CLICK
  // ════════════════════════════════════════════

  ai.action('browser_click', {
    description: 'Click an element on the page. Find by CSS selector or by visible text content. Use this to interact with buttons, links, tabs, etc.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector (e.g. "#submit-btn", ".nav-link", "button[type=submit]")',
        required: false,
      },
      text: {
        type: 'string',
        description: 'Visible text to find and click (e.g. "Submit", "Next", "Guardar"). Searches buttons, links, and clickable elements.',
        required: false,
      },
    },
    handler: async (params, api) => {
      const result = clickElement(params.selector, params.text);
      if (!result.error) {
        api.emit?.('browser:clicked', { selector: params.selector, text: params.text });
      }
      return result;
    },
    permissions: ['emitEvents'],
  });

  // ════════════════════════════════════════════
  // TYPE
  // ════════════════════════════════════════════

  ai.action('browser_type', {
    description: 'Type text into an input, textarea, or contenteditable element. Works with React, Vue, Angular, and other frameworks. Can optionally clear existing text first and submit the form.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input (e.g. "#email", "input[name=search]", "textarea.comment")',
        required: true,
      },
      text: {
        type: 'string',
        description: 'Text to type into the element',
        required: true,
      },
      clear: {
        type: 'boolean',
        description: 'Clear existing value before typing (default: false)',
        required: false,
      },
      submit: {
        type: 'boolean',
        description: 'Submit the form or press Enter after typing (default: false)',
        required: false,
      },
    },
    handler: async (params, api) => {
      const result = typeIntoElement(params.selector, params.text, {
        clear: params.clear,
        submit: params.submit,
      });
      if (!result.error) {
        api.emit?.('browser:typed', { selector: params.selector, length: params.text.length });
      }
      return result;
    },
    permissions: ['emitEvents'],
  });

  // ════════════════════════════════════════════
  // SELECT (dropdowns)
  // ════════════════════════════════════════════

  ai.action('browser_select', {
    description: 'Select an option in a <select> dropdown or a custom dropdown component.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector of the <select> element',
        required: true,
      },
      value: {
        type: 'string',
        description: 'The value attribute of the option to select. Use "text:" prefix to match by visible text (e.g. "text:Mexico")',
        required: true,
      },
    },
    handler: async (params, api) => {
      const el = document.querySelector(params.selector);
      if (!el) return { error: `Element not found: ${params.selector}` };

      if (el.tagName?.toLowerCase() === 'select') {
        const options = Array.from(el.options);
        let option;

        if (params.value.startsWith('text:')) {
          const searchText = params.value.slice(5).toLowerCase();
          option = options.find((o) => o.textContent.trim().toLowerCase().includes(searchText));
        } else {
          option = options.find((o) => o.value === params.value);
        }

        if (!option) return { error: `Option not found: ${params.value}` };

        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));

        api.emit?.('browser:selected', { selector: params.selector, value: option.value });
        return { selected: option.value, text: option.textContent.trim() };
      }

      // Custom dropdown: try clicking the trigger, then the option
      el.click();
      return { clicked: params.selector, note: 'Custom dropdown — clicked trigger. Use browser_click to select an option from the opened menu.' };
    },
    permissions: ['emitEvents'],
  });

  // ════════════════════════════════════════════
  // SCROLL
  // ════════════════════════════════════════════

  ai.action('browser_scroll', {
    description: 'Scroll the page or a specific element. Use to reveal content that is not visible.',
    parameters: {
      direction: {
        type: 'string',
        description: 'Direction: "up", "down", "top", "bottom"',
        required: true,
      },
      selector: {
        type: 'string',
        description: 'CSS selector of scrollable container (empty = page)',
        required: false,
      },
      amount: {
        type: 'number',
        description: 'Pixels to scroll (default: 500). Ignored for "top"/"bottom".',
        required: false,
      },
    },
    handler: async (params) => {
      const target = params.selector
        ? document.querySelector(params.selector)
        : window;
      const amount = params.amount || 500;

      if (params.selector && !target) return { error: `Element not found: ${params.selector}` };

      const scrollEl = target === window ? document.documentElement : target;

      switch (params.direction) {
        case 'up': scrollEl.scrollBy({ top: -amount, behavior: 'smooth' }); break;
        case 'down': scrollEl.scrollBy({ top: amount, behavior: 'smooth' }); break;
        case 'top': scrollEl.scrollTo({ top: 0, behavior: 'smooth' }); break;
        case 'bottom': scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' }); break;
        default: return { error: `Invalid direction: ${params.direction}` };
      }

      return {
        scrolled: params.direction,
        amount: params.direction === 'top' || params.direction === 'bottom' ? 'max' : amount,
        currentScroll: scrollEl.scrollTop,
      };
    },
    permissions: [],
  });

  // ════════════════════════════════════════════
  // SNAPSHOT — Accessibility tree
  // ════════════════════════════════════════════

  ai.action('browser_snapshot', {
    description: 'Get a text representation of the visible DOM structure (accessibility tree). Use this to understand what elements are on the page, their roles, IDs, and text content. Cheaper and faster than a screenshot.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector to snapshot (empty = full page). Use "[data-wu-app=appName]" for a specific micro-app.',
        required: false,
      },
      depth: {
        type: 'number',
        description: 'Max depth to traverse (default: 5)',
        required: false,
      },
    },
    handler: async (params) => {
      const target = params.selector
        ? document.querySelector(params.selector)
        : document.body;

      if (!target) return { error: `Element not found: ${params.selector}` };

      const tree = buildA11yTree(target, 0, params.depth || 5);
      return { snapshot: tree };
    },
    permissions: [],
  });

  // ════════════════════════════════════════════
  // NAVIGATE
  // ════════════════════════════════════════════

  ai.action('browser_navigate', {
    description: 'Navigate to a route within the SPA application. Emits a shell:navigate event and updates the store.',
    parameters: {
      route: {
        type: 'string',
        description: 'Route path (e.g. "/dashboard", "/users", "/pos/cotizador")',
        required: true,
      },
    },
    handler: async (params, api) => {
      api.emit?.('shell:navigate', { route: params.route });
      api.setState?.('currentPath', params.route);
      return { navigated: params.route };
    },
    permissions: ['emitEvents', 'writeStore'],
  });

  // ════════════════════════════════════════════
  // NETWORK — Captured HTTP requests
  // ════════════════════════════════════════════

  ai.action('browser_network', {
    description: 'View captured HTTP network requests (fetch and XHR). Shows URL, method, status code, duration, and size. Use to debug API calls, check for errors, or monitor performance.',
    parameters: {
      method: {
        type: 'string',
        description: 'Filter by HTTP method: GET, POST, PUT, DELETE (empty = all)',
        required: false,
      },
      status: {
        type: 'string',
        description: 'Filter: "2" (2xx success), "4" (4xx errors), "5" (5xx errors), "error" (all failures)',
        required: false,
      },
      limit: {
        type: 'number',
        description: 'Max requests to return (default: 30)',
        required: false,
      },
    },
    handler: async (params) => getFilteredNetwork(params.method, params.status, params.limit),
    permissions: [],
  });

  // ════════════════════════════════════════════
  // CONSOLE — Captured logs
  // ════════════════════════════════════════════

  ai.action('browser_console', {
    description: 'View captured browser console messages (log, warn, error). Use to check for errors, warnings, or debug output.',
    parameters: {
      level: {
        type: 'string',
        description: 'Filter by level: "log", "warn", "error" (empty = all)',
        required: false,
      },
      limit: {
        type: 'number',
        description: 'Max messages to return (default: 30)',
        required: false,
      },
    },
    handler: async (params) => getFilteredConsole(params.level, params.limit),
    permissions: [],
  });

  // ════════════════════════════════════════════
  // INFO — Page state overview
  // ════════════════════════════════════════════

  ai.action('browser_info', {
    description: 'Get an overview of the current page state: URL, viewport size, mounted micro-apps, store keys, visible elements summary. Use this FIRST to understand the page before taking actions.',
    parameters: {},
    handler: async (params, api) => {
      const apps = [];

      // Discover mounted apps
      if (wu._apps) {
        for (const [name, app] of Object.entries(wu._apps)) {
          apps.push({
            name,
            mounted: app.mounted || app.isMounted || false,
            status: app.status || 'unknown',
          });
        }
      }
      if (apps.length === 0) {
        document.querySelectorAll('[data-wu-app]').forEach((el) => {
          apps.push({ name: el.getAttribute('data-wu-app'), mounted: true });
        });
      }

      const storeData = api.getState?.('') || {};
      const storeKeys = typeof storeData === 'object' ? Object.keys(storeData) : [];

      return {
        url: window.location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        apps,
        storeKeys,
        networkRequests: networkLog.length,
        consoleMessages: consoleLog.length,
        consoleErrors: consoleLog.filter((m) => m.level === 'error').length,
      };
    },
    permissions: ['readStore'],
  });
}

// All private helpers (buildA11yTree, inlineComputedStyles, interceptors)
// are now in wu-ai-browser-primitives.js — single source of truth.
