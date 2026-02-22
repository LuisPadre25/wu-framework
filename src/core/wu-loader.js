/**
 * 🚀 WU-LOADER: SISTEMA DE CARGA DINÁMICA UNIVERSAL
 * Carga aplicaciones y componentes sin depender del framework
 */

import { logger } from './wu-logger.js';

export class WuLoader {
  constructor() {
    this.cache = new Map();
    this.loadingPromises = new Map();

    logger.debug('[WuLoader] 📦 Dynamic loader initialized');
  }

  /**
   * Cargar aplicación completa
   * @param {string} appUrl - URL base de la aplicación
   * @param {Object} manifest - Manifest de la aplicación
   * @returns {string} Código JavaScript de la aplicación
   */
  async loadApp(appUrl, manifest) {
    const entryFile = manifest?.entry || 'index.js';
    const fullUrl = `${appUrl}/${entryFile}`;

    logger.debug(`[WuLoader] 📥 Loading app from: ${fullUrl}`);

    try {
      // Verificar cache
      if (this.cache.has(fullUrl)) {
        logger.debug(`[WuLoader] ⚡ Cache hit for: ${fullUrl}`);
        return this.cache.get(fullUrl);
      }

      // Verificar si ya está cargando
      if (this.loadingPromises.has(fullUrl)) {
        logger.debug(`[WuLoader] ⏳ Loading in progress for: ${fullUrl}`);
        return await this.loadingPromises.get(fullUrl);
      }

      // Crear promesa de carga
      const loadingPromise = this.fetchCode(fullUrl);
      this.loadingPromises.set(fullUrl, loadingPromise);

      const code = await loadingPromise;

      // Limpiar promesa de carga y cachear resultado
      this.loadingPromises.delete(fullUrl);
      this.cache.set(fullUrl, code);

      logger.debug(`[WuLoader] ✅ App loaded successfully: ${fullUrl}`);
      return code;

    } catch (error) {
      this.loadingPromises.delete(fullUrl);
      console.error(`[WuLoader] ❌ Failed to load app: ${fullUrl}`, error);
      throw new Error(`Failed to load app from ${fullUrl}: ${error.message}`);
    }
  }

  /**
   * Cargar componente específico
   * @param {string} appUrl - URL base de la aplicación
   * @param {string} componentPath - Ruta del componente
   * @returns {Function} Función del componente
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

    logger.debug(`[WuLoader] 🧩 Loading component from: ${fullUrl}`);

    try {
      // Cargar código del componente
      const code = await this.loadCode(fullUrl);

      // Crear función que retorna el componente
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

      logger.debug(`[WuLoader] ✅ Component loaded: ${componentPath}`);
      return component;

    } catch (error) {
      console.error(`[WuLoader] ❌ Failed to load component: ${componentPath}`, error);
      throw new Error(`Failed to load component ${componentPath}: ${error.message}`);
    }
  }

  /**
   * Cargar código con cache
   * @param {string} url - URL del archivo
   * @returns {string} Código JavaScript
   */
  async loadCode(url) {
    // Verificar cache
    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    // Verificar si ya está cargando
    if (this.loadingPromises.has(url)) {
      return await this.loadingPromises.get(url);
    }

    // Crear promesa de carga
    const loadingPromise = this.fetchCode(url);
    this.loadingPromises.set(url, loadingPromise);

    try {
      const code = await loadingPromise;
      this.loadingPromises.delete(url);
      this.cache.set(url, code);
      return code;
    } catch (error) {
      this.loadingPromises.delete(url);
      throw error;
    }
  }

  /**
   * Realizar fetch del código
   * @param {string} url - URL del archivo
   * @returns {string} Código JavaScript
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
    logger.debug(`[WuLoader] 🚀 Preloading ${appConfigs.length} apps...`);

    const preloadPromises = appConfigs.map(async (config) => {
      try {
        await this.loadApp(config.url, config.manifest);
        logger.debug(`[WuLoader] ✅ Preloaded: ${config.name}`);
      } catch (error) {
        logger.warn(`[WuLoader] ⚠️ Failed to preload ${config.name}:`, error.message);
      }
    });

    await Promise.allSettled(preloadPromises);
    logger.debug(`[WuLoader] 🎉 Preload completed`);
  }

  /**
   * Verificar si una URL está disponible
   * @param {string} url - URL a verificar
   * @returns {boolean} True si está disponible
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
        logger.debug(`[WuLoader] ✅ Resolved dependency: ${importPath}`);
      } catch (error) {
        console.error(`[WuLoader] ❌ Failed to resolve: ${importPath}`, error);
      }
    }

    return resolved;
  }

  /**
   * Limpiar cache
   * @param {string} pattern - Patrón opcional para limpiar URLs específicas
   */
  clearCache(pattern) {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const [url] of this.cache) {
        if (regex.test(url)) {
          this.cache.delete(url);
          logger.debug(`[WuLoader] 🗑️ Cleared cache for: ${url}`);
        }
      }
    } else {
      this.cache.clear();
      logger.debug(`[WuLoader] 🗑️ Cache cleared completely`);
    }
  }

  /**
   * Obtener estadísticas del loader
   */
  getStats() {
    return {
      cached: this.cache.size,
      loading: this.loadingPromises.size,
      cacheKeys: Array.from(this.cache.keys())
    };
  }
}