/**
 * WU-HTML-PARSER: Fetch and parse HTML entries from micro-apps.
 *
 * Used in "strict" sandbox mode. The flow:
 * 1. Fetch the HTML page at the app's URL
 * 2. Parse it: extract inline/external scripts, inline/external styles, and clean DOM
 * 3. Return structured result so wu-core can inject DOM + styles into Shadow DOM
 *    and execute scripts inside the proxy sandbox via WuScriptExecutor.
 *
 * This is the qiankun-style "HTML entry" approach that enables real JS isolation.
 */

import { logger } from './wu-logger.js';

export class WuHtmlParser {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Fetch HTML content from a URL.
   * @param {string} url - App URL (e.g. http://localhost:3001)
   * @param {string} appName - For logging
   * @returns {Promise<string>} Raw HTML string
   */
  async fetchHtml(url, appName) {
    logger.wuDebug(`[HtmlParser] Fetching HTML for ${appName} from ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' }
    });

    if (!response.ok) {
      throw new Error(`[HtmlParser] Failed to fetch ${url}: HTTP ${response.status}`);
    }

    const html = await response.text();
    if (!html || !html.trim()) {
      throw new Error(`[HtmlParser] Empty HTML response from ${url}`);
    }

    logger.wuDebug(`[HtmlParser] Fetched ${html.length} chars for ${appName}`);
    return html;
  }

  /**
   * Parse HTML string into structured parts.
   *
   * @param {string} html - Raw HTML
   * @param {string} appName - App identifier
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {{
   *   dom: string,
   *   scripts: { inline: string[], external: string[] },
   *   styles: { inline: string[], external: string[] }
   * }}
   */
  parse(html, appName, baseUrl) {
    const cacheKey = `${appName}:${html.length}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const inlineScripts = [];
    const externalScripts = [];
    const inlineStyles = [];
    const externalStyles = [];

    this._extractResources(temp, {
      inlineScripts, externalScripts,
      inlineStyles, externalStyles,
      baseUrl
    });

    const result = {
      dom: temp.innerHTML,
      scripts: { inline: inlineScripts, external: externalScripts },
      styles: { inline: inlineStyles, external: externalStyles }
    };

    this._cache.set(cacheKey, result);

    logger.wuDebug(
      `[HtmlParser] ${appName}: ${inlineScripts.length} inline scripts, ` +
      `${externalScripts.length} external scripts, ` +
      `${inlineStyles.length + externalStyles.length} styles`
    );

    return result;
  }

  /**
   * Convenience: fetch + parse in one call.
   */
  async fetchAndParse(url, appName) {
    const html = await this.fetchHtml(url, appName);
    return this.parse(html, appName, url);
  }

  /**
   * Recursively walk the DOM, extracting scripts and styles,
   * replacing them with comments to keep the DOM clean.
   */
  _extractResources(element, ctx) {
    // Iterate over a static copy since we mutate the DOM
    const children = Array.from(element.children);

    for (const child of children) {
      const tag = child.nodeName.toLowerCase();

      if (tag === 'script') {
        this._extractScript(child, ctx);
        child.replaceWith(document.createComment('wu:script'));
        continue;
      }

      if (tag === 'style') {
        const text = child.textContent?.trim();
        if (text) ctx.inlineStyles.push(text);
        child.replaceWith(document.createComment('wu:style'));
        continue;
      }

      if (tag === 'link') {
        const rel = child.getAttribute('rel');
        const href = child.getAttribute('href');
        if (rel === 'stylesheet' && href) {
          ctx.externalStyles.push(this._resolveUrl(href, ctx.baseUrl));
          child.replaceWith(document.createComment('wu:link'));
          continue;
        }
      }

      // Recurse into children
      if (child.children.length > 0) {
        this._extractResources(child, ctx);
      }
    }
  }

  /**
   * Extract a <script> tag into inline or external list.
   * Skips type="module" scripts (they can't be eval'd — use module mode for those).
   */
  _extractScript(el, ctx) {
    const type = el.getAttribute('type') || '';
    const src = el.getAttribute('src');

    // Module scripts can't be executed via new Function / eval.
    // If the app uses ES modules, it should use sandbox: 'module' mode.
    if (type === 'module') {
      logger.wuDebug('[HtmlParser] Skipping type="module" script (use sandbox: "module" for ES modules)');
      return;
    }

    if (src) {
      ctx.externalScripts.push(this._resolveUrl(src, ctx.baseUrl));
    } else {
      const text = el.textContent?.trim();
      if (text) ctx.inlineScripts.push(text);
    }
  }

  /**
   * Resolve a relative URL against a base URL.
   */
  _resolveUrl(url, baseUrl) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;

    try {
      return new URL(url, baseUrl).href;
    } catch {
      // Fallback for environments without URL constructor
      const base = baseUrl.replace(/\/$/, '');
      return url.startsWith('/') ? base + url : `${base}/${url}`;
    }
  }

  /**
   * Clear the parse cache.
   */
  clearCache() {
    this._cache.clear();
  }
}
