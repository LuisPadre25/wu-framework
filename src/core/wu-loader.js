/**
 * WU-LOADER: SISTEMA DE CARGA DINAMICA UNIVERSAL
 * Carga aplicaciones y componentes sin depender del framework
 *
 * Cache strategy: LRU with TTL eviction.
 * Entries track lastAccess time. When the cache reaches maxCacheSize,
 * the least recently accessed entry is evicted. Entries older than
 * cacheTTL are treated as stale and removed on access or eviction.
 */

import { logger } from './wu-logger.js';

/**
 * @typedef {Object} WuLoaderOptions
 * @property {number} [maxCacheSize=50] - Maximum cache entries
 * @property {number} [cacheTTL=1800000] - Cache TTL in ms (default 30min)
 */

/**
 * @typedef {Object} WuLoaderStats
 * @property {number} cached - Number of cached entries
 * @property {number} loading - Number of in-flight loads
 * @property {number} maxCacheSize - Max cache size setting
 * @property {number} cacheTTL - Cache TTL setting
 * @property {string[]} cacheKeys - Cached URL keys
 */

export class WuLoader {
  /**
   * @param {Object} options
   * @param {number} [options.maxCacheSize=50] - Maximum number of entries in the cache
   * @param {number} [options.cacheTTL=1800000] - Time-to-live for cache entries in ms (default 30 minutes)
   */
  constructor(options = {}) {
    this.maxCacheSize = options.maxCacheSize ?? 50;
    this.cacheTTL = options.cacheTTL ?? 1800000;
    this.cache = new Map();
    this.loadingPromises = new Map();

    logger.debug('[WuLoader] Dynamic loader initialized');
  }

  /**
   * Read from cache with TTL validation and LRU access tracking.
   * Returns undefined if the entry does not exist or has expired.
   * @param {string} key
   * @returns {string|undefined}
   */
  _cacheGet(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const entry = this.cache.get(key);
    const now = Date.now();

    if (now - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      logger.debug(`[WuLoader] Cache expired for: ${key}`);
      return undefined;
    }

    // Promote: delete and re-insert so iteration order reflects recency.
    // Map iteration order in JS follows insertion order, so the oldest
    // inserted entry is always first -- exactly what we need for LRU eviction.
    this.cache.delete(key);
    entry.lastAccess = now;
    this.cache.set(key, entry);

    return entry.code;
  }

  /**
   * Write to cache. Evicts stale and LRU entries before inserting.
   * @param {string} key
   * @param {string} code
   */
  _cacheSet(key, code) {
    // If the key already exists, remove it first so re-insertion
    // moves it to the end (most-recently-used position).
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this._evictIfNeeded();

    const now = Date.now();
    this.cache.set(key, {
      code,
      timestamp: now,
      lastAccess: now
    });
  }

  /**
   * Evict entries until cache is below maxCacheSize.
   *
   * Two-pass strategy:
   *   1. Remove all expired entries (TTL exceeded).
   *   2. If still at capacity, remove the least recently accessed entry.
   *      Because Map preserves insertion order and _cacheGet promotes on
   *      access, the first key from the iterator is always the LRU entry.
   */
  _evictIfNeeded() {
    const now = Date.now();

    // Pass 1: purge expired entries
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.cacheTTL) {
        this.cache.delete(key);
        logger.debug(`[WuLoader] Evicted expired entry: ${key}`);
      }
    }

    // Pass 2: evict LRU entries until we are under the limit
    while (this.cache.size >= this.maxCacheSize) {
      // Map.keys().next() gives us the oldest-inserted key (LRU)
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug(`[WuLoader] Evicted LRU entry: ${oldestKey}`);
    }
  }

  /**
   * Cargar aplicacion completa
   * @param {string} appUrl - URL base de la aplicacion
   * @param {Object} manifest - Manifest de la aplicacion
   * @returns {string} Codigo JavaScript de la aplicacion
   */
  async loadApp(appUrl, manifest) {
    const entryFile = manifest?.entry || 'index.js';
    const fullUrl = `${appUrl}/${entryFile}`;

    logger.debug(`[WuLoader] Loading app from: ${fullUrl}`);

    try {
      // Check cache with TTL and LRU tracking
      const cached = this._cacheGet(fullUrl);
      if (cached !== undefined) {
        logger.debug(`[WuLoader] Cache hit for: ${fullUrl}`);
        return cached;
      }

      // Check if already loading
      if (this.loadingPromises.has(fullUrl)) {
        logger.debug(`[WuLoader] Loading in progress for: ${fullUrl}`);
        return await this.loadingPromises.get(fullUrl);
      }

      // Create loading promise
      const loadingPromise = this.fetchCode(fullUrl);
      this.loadingPromises.set(fullUrl, loadingPromise);

      const code = await loadingPromise;

      // Clean up loading promise and cache result
      this.loadingPromises.delete(fullUrl);
      this._cacheSet(fullUrl, code);

      logger.debug(`[WuLoader] App loaded successfully: ${fullUrl}`);
      return code;

    } catch (error) {
      this.loadingPromises.delete(fullUrl);
      console.error(`[WuLoader] Failed to load app: ${fullUrl}`, error);
      throw new Error(`Failed to load app from ${fullUrl}: ${error.message}`);
    }
  }

  /**
   * Cargar componente especifico
   * @param {string} appUrl - URL base de la aplicacion
   * @param {string} componentPath - Ruta del componente
   * @returns {Function} Funcion del componente
   */
  async loadComponent(appUrl, componentPath) {
    // Normalizar ruta del componente
    let normalizedPath = componentPath;
    if (normalizedPath.startsWith('./')) {
      normalizedPath = normalizedPath.substring(2);
    }
    if (!normalizedPath.endsWith('.js') && !normalizedPath.endsWith('.jsx')) {
      normalizedPath += '.js';
    }

    const fullUrl = `${appUrl}/${normalizedPath}`;

    logger.debug(`[WuLoader] Loading component from: ${fullUrl}`);

    try {
      // Cargar codigo del componente
      const code = await this.loadCode(fullUrl);

      // Crear funcion que retorna el componente
      const componentFunction = new Function('require', 'module', 'exports', `
        ${code}
        return typeof module.exports === 'function' ? module.exports :
               typeof module.exports === 'object' && module.exports.default ? module.exports.default :
               exports.default || exports;
      `);

      // Ejecutar y obtener el componente
      const fakeModule = { exports: {} };
      const fakeRequire = (name) => {
        logger.warn(`[WuLoader] Component ${componentPath} requires ${name} - not supported yet`);
        return {};
      };

      const component = componentFunction(fakeRequire, fakeModule, fakeModule.exports);

      logger.debug(`[WuLoader] Component loaded: ${componentPath}`);
      return component;

    } catch (error) {
      console.error(`[WuLoader] Failed to load component: ${componentPath}`, error);
      throw new Error(`Failed to load component ${componentPath}: ${error.message}`);
    }
  }

  /**
   * Cargar codigo con cache
   * @param {string} url - URL del archivo
   * @returns {string} Codigo JavaScript
   */
  async loadCode(url) {
    // Check cache with TTL and LRU tracking
    const cached = this._cacheGet(url);
    if (cached !== undefined) {
      return cached;
    }

    // Check if already loading
    if (this.loadingPromises.has(url)) {
      return await this.loadingPromises.get(url);
    }

    // Create loading promise
    const loadingPromise = this.fetchCode(url);
    this.loadingPromises.set(url, loadingPromise);

    try {
      const code = await loadingPromise;
      this.loadingPromises.delete(url);
      this._cacheSet(url, code);
      return code;
    } catch (error) {
      this.loadingPromises.delete(url);
      throw error;
    }
  }

  /**
   * Realizar fetch del codigo
   * @param {string} url - URL del archivo
   * @returns {string} Codigo JavaScript
   */
  async fetchCode(url) {
    const response = await fetch(url, {
      cache: 'no-cache',
      headers: {
        'Accept': 'application/javascript, text/javascript, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const code = await response.text();

    if (!code.trim()) {
      throw new Error('Empty response');
    }

    return code;
  }

  /**
   * Precargar aplicaciones
   * @param {Array} appConfigs - Configuraciones de aplicaciones
   */
  async preload(appConfigs) {
    logger.debug(`[WuLoader] Preloading ${appConfigs.length} apps...`);

    const preloadPromises = appConfigs.map(async (config) => {
      try {
        await this.loadApp(config.url, config.manifest);
        logger.debug(`[WuLoader] Preloaded: ${config.name}`);
      } catch (error) {
        logger.warn(`[WuLoader] Failed to preload ${config.name}:`, error.message);
      }
    });

    await Promise.allSettled(preloadPromises);
    logger.debug(`[WuLoader] Preload completed`);
  }

  /**
   * Verificar si una URL esta disponible
   * @param {string} url - URL a verificar
   * @returns {boolean} True si esta disponible
   */
  async isAvailable(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolver dependencias de imports
   * @param {Array} imports - Lista de imports del manifest
   * @param {Map} availableApps - Apps disponibles
   */
  async resolveDependencies(imports, availableApps) {
    const resolved = new Map();

    for (const importPath of imports || []) {
      const [appName, componentName] = importPath.split('.');

      if (!appName || !componentName) {
        logger.warn(`[WuLoader] Invalid import format: ${importPath}`);
        continue;
      }

      const app = availableApps.get(appName);
      if (!app) {
        logger.warn(`[WuLoader] Import app not found: ${appName}`);
        continue;
      }

      const manifest = app.manifest;
      const exportPath = manifest?.wu?.exports?.[componentName];

      if (!exportPath) {
        logger.warn(`[WuLoader] Export not found: ${importPath}`);
        continue;
      }

      try {
        const component = await this.loadComponent(app.url, exportPath);
        resolved.set(importPath, component);
        logger.debug(`[WuLoader] Resolved dependency: ${importPath}`);
      } catch (error) {
        console.error(`[WuLoader] Failed to resolve: ${importPath}`, error);
      }
    }

    return resolved;
  }

  /**
   * Limpiar cache
   * @param {string} pattern - Patron opcional para limpiar URLs especificas
   */
  clearCache(pattern) {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const [url] of this.cache) {
        if (regex.test(url)) {
          this.cache.delete(url);
          logger.debug(`[WuLoader] Cleared cache for: ${url}`);
        }
      }
    } else {
      this.cache.clear();
      logger.debug(`[WuLoader] Cache cleared completely`);
    }
  }

  /**
   * Obtener estadisticas del loader
   */
  getStats() {
    return {
      cached: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      cacheTTL: this.cacheTTL,
      loading: this.loadingPromises.size,
      cacheKeys: Array.from(this.cache.keys())
    };
  }
}
