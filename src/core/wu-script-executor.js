/**
 * WU-SCRIPT-EXECUTOR: Execute scripts inside a Proxy sandbox.
 *
 * Two isolation levels:
 * - strictGlobal: true  → with(proxy) { code } — all global access goes through proxy
 * - strictGlobal: false → (function(window){ code })(proxy) — only explicit window.xxx
 *
 * This is what makes the sandbox REAL instead of decorative.
 * Without this, import() runs code in global scope and the proxy is just a cleanup tracker.
 * With this, code receives the proxy as "window" and every setTimeout, addEventListener,
 * document.querySelector, localStorage access goes through the proxy's traps.
 */

import { logger } from './wu-logger.js';

export class WuScriptExecutor {

  /**
   * Dangerous patterns that indicate prototype pollution, sandbox escape,
   * or direct access to sensitive APIs. Each entry is a regex paired with
   * a human-readable label used in error messages.
   *
   * This is a tripwire, not a full parser. It catches the most common
   * attack vectors without the overhead of AST analysis.
   */
  static DANGEROUS_PATTERNS = [
    // Prototype pollution vectors
    { pattern: /constructor\s*\[\s*['"`]constructor['"`]\s*\]/, label: 'constructor chain access (sandbox escape)' },
    { pattern: /__proto__/, label: '__proto__ access (prototype pollution)' },

    // Sandbox escape via proxy introspection
    { pattern: /Object\s*\.\s*getPrototypeOf\s*\(\s*proxy\s*\)/, label: 'Object.getPrototypeOf(proxy) (sandbox escape)' },

    // Dynamic code generation that bypasses the sandbox
    { pattern: /Function\s*\(\s*['"`]/, label: 'Function() constructor (dynamic code generation)' },
    { pattern: /\beval\s*\(/, label: 'eval() (dynamic code execution)' },

    // Dynamic import escapes the sandbox entirely (runs in global scope)
    { pattern: /\bimport\s*\(/, label: 'import() (dynamic import escapes sandbox)' },

    // Direct cookie access (should go through proxy traps, not raw document)
    { pattern: /document\s*\.\s*cookie/, label: 'document.cookie (direct cookie access)' },
  ];

  /**
   * Validate script text against known dangerous patterns before execution.
   * Throws if any pattern matches. This is intentionally lightweight --
   * pattern detection only, not a full parse.
   *
   * @param {string} scriptText - The raw script to validate
   * @param {string} appName - App identifier (for error context)
   * @throws {Error} If a dangerous pattern is detected
   */
  _validateScript(scriptText, appName) {
    for (const { pattern, label } of WuScriptExecutor.DANGEROUS_PATTERNS) {
      if (pattern.test(scriptText)) {
        const msg = `[ScriptExecutor] Blocked dangerous pattern in "${appName}": ${label}`;
        logger.wuError(msg);
        throw new Error(msg);
      }
    }
  }

  /**
   * Execute a script string inside the proxy sandbox.
   *
   * @param {string} scriptText - JavaScript code to execute
   * @param {string} appName - App identifier (for logging)
   * @param {Proxy} proxy - The activated proxy sandbox
   * @param {Object} [options]
   * @param {boolean} [options.strictGlobal=true] - Use with(proxy) for maximum isolation
   * @param {string} [options.sourceUrl=''] - Source URL for devtools (//# sourceURL)
   * @returns {*} Return value of the executed code
   */
  execute(scriptText, appName, proxy, options = {}) {
    const { strictGlobal = true, sourceUrl = '' } = options;

    if (!scriptText || !scriptText.trim()) return;

    this._validateScript(scriptText, appName);

    const sourceComment = sourceUrl ? `\n//# sourceURL=wu-sandbox:///${appName}/${sourceUrl}\n` : '';

    let wrappedCode;

    if (strictGlobal) {
      // MAXIMUM ISOLATION
      // with(window) makes ALL unqualified identifiers (setTimeout, fetch, document, etc.)
      // resolve through the proxy's has/get traps, not the real window.
      // Note: 'use strict' inside the with block becomes a no-op string expression,
      // so bundled code with strict mode still works.
      wrappedCode = `;(function(window, self, globalThis, top, parent) {
  with(window) {
    ;${scriptText}${sourceComment}
  }
}).call(proxy, proxy, proxy, proxy, proxy, proxy);`;
    } else {
      // IIFE ONLY — only explicit window.xxx goes through proxy
      wrappedCode = `;(function(window, self, globalThis, top, parent) {
  ;${scriptText}${sourceComment}
}).call(proxy, proxy, proxy, proxy, proxy, proxy);`;
    }

    try {
      // new Function('proxy', code) creates a function with 'proxy' as the single param.
      // This avoids polluting scope — the only bridge to the sandbox is the proxy argument.
      const fn = new Function('proxy', wrappedCode);
      return fn(proxy);
    } catch (error) {
      // If strictGlobal failed (rare edge case with with-statement), retry without it
      if (strictGlobal) {
        logger.wuWarn(`[ScriptExecutor] strictGlobal failed for ${appName}, retrying without with(): ${error.message}`);
        return this.execute(scriptText, appName, proxy, { ...options, strictGlobal: false });
      }
      logger.wuError(`[ScriptExecutor] Execution failed for ${appName}:`, error);
      throw error;
    }
  }

  /**
   * Fetch script content from a URL.
   * @param {string} url - Script URL
   * @returns {Promise<string>} Script text
   */
  async fetchScript(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch script ${url}: HTTP ${response.status}`);
    }
    return response.text();
  }

  /**
   * Execute an array of scripts in sequence inside the proxy.
   * External scripts (with src) are fetched first.
   *
   * @param {Array<{content?: string, src?: string}>} scripts
   * @param {string} appName
   * @param {Proxy} proxy
   * @param {Object} [options]
   */
  async executeAll(scripts, appName, proxy, options = {}) {
    for (const script of scripts) {
      let text = script.content;

      if (!text && script.src) {
        logger.wuDebug(`[ScriptExecutor] Fetching external script: ${script.src}`);
        text = await this.fetchScript(script.src);
      }

      if (text && text.trim()) {
        this.execute(text, appName, proxy, {
          ...options,
          sourceUrl: script.src || options.sourceUrl || ''
        });
      }
    }

    logger.wuDebug(`[ScriptExecutor] Executed ${scripts.length} scripts for ${appName}`);
  }
}
