/**
 * 🔗 WU-DEPENDENCY-RESOLVER: SISTEMA DE RESOLUCIÓN DE DEPENDENCIAS
 * Maneja imports/exports entre micro-apps
 */

import { logger } from '../core/wu-logger.js';

export class WuDependencyResolver {
  constructor() {
    this.resolvedComponents = new Map();
    this.pendingResolutions = new Map();

    logger.debug('[WuDependencyResolver] 🔗 Dependency resolver initialized');
  }

  /**
   * Resolver todas las dependencias de una app
   * @param {Array} imports - Lista de imports del manifest
   * @param {Map} availableApps - Apps disponibles
   * @returns {Map} Componentes resueltos
   */
  async resolveAll(imports, availableApps) {
    logger.debug(`[WuDependencyResolver] 🔍 Resolving ${imports.length} dependencies...`);

    const resolved = new Map();
    const errors = [];

    for (const importPath of imports) {
      try {
        const component = await this.resolve(importPath, availableApps);
        resolved.set(importPath, component);
        logger.debug(`[WuDependencyResolver] ✅ Resolved: ${importPath}`);
      } catch (error) {
        errors.push({ import: importPath, error: error.message });
        logger.warn(`[WuDependencyResolver] ❌ Failed to resolve: ${importPath}`, error);
      }
    }

    if (errors.length > 0) {
      logger.warn(`[WuDependencyResolver] ⚠️ ${errors.length} dependencies failed to resolve:`, errors);
    }

    logger.debug(`[WuDependencyResolver] 🎉 Resolved ${resolved.size}/${imports.length} dependencies`);
    return resolved;
  }

  /**
   * Resolver una dependencia específica
   * @param {string} importPath - Ruta de import (ej: "shared.Button")
   * @param {Map} availableApps - Apps disponibles
   * @returns {Function} Componente resuelto
   */
  async resolve(importPath, availableApps) {
    // Verificar cache
    if (this.resolvedComponents.has(importPath)) {
      logger.debug(`[WuDependencyResolver] ⚡ Cache hit: ${importPath}`);
      return this.resolvedComponents.get(importPath);
    }

    // Verificar si ya está resolviendo
    if (this.pendingResolutions.has(importPath)) {
      logger.debug(`[WuDependencyResolver] ⏳ Waiting for pending resolution: ${importPath}`);
      return await this.pendingResolutions.get(importPath);
    }

    // Crear promesa de resolución
    const resolutionPromise = this.performResolution(importPath, availableApps);
    this.pendingResolutions.set(importPath, resolutionPromise);

    try {
      const component = await resolutionPromise;
      this.pendingResolutions.delete(importPath);
      this.resolvedComponents.set(importPath, component);
      return component;
    } catch (error) {
      this.pendingResolutions.delete(importPath);
      throw error;
    }
  }

  /**
   * Realizar la resolución efectiva
   * @param {string} importPath - Ruta de import
   * @param {Map} availableApps - Apps disponibles
   * @returns {Function} Componente resuelto
   */
  async performResolution(importPath, availableApps) {
    const [appName, componentName] = importPath.split('.');

    if (!appName || !componentName) {
      throw new Error(`Invalid import format: ${importPath}. Use "app.component"`);
    }

    // Buscar la app
    const app = availableApps.get(appName);
    if (!app) {
      throw new Error(`App not found: ${appName}`);
    }

    // Buscar el export en el manifest
    const manifest = app.manifest;
    const exportPath = manifest?.wu?.exports?.[componentName];

    if (!exportPath) {
      throw new Error(`Component ${componentName} not exported by ${appName}`);
    }

    // Cargar el componente usando el loader de la app
    const loader = app.loader || this.getDefaultLoader();
    const component = await loader.loadComponent(app.url, exportPath);

    if (!component) {
      throw new Error(`Failed to load component: ${importPath}`);
    }

    return component;
  }

  /**
   * Obtener loader por defecto si la app no tiene uno
   */
  getDefaultLoader() {
    if (!this._defaultLoader) {
      // Crear un loader básico si no hay uno disponible
      this._defaultLoader = {
        loadComponent: async (appUrl, componentPath) => {
          const fullUrl = `${appUrl}/${componentPath}`;
          const response = await fetch(fullUrl);

          if (!response.ok) {
            throw new Error(`Failed to fetch: ${fullUrl}`);
          }

          const code = await response.text();

          // Evaluar código del componente
          const componentFunction = new Function('require', 'module', 'exports', `
            ${code}
            return typeof module.exports === 'function' ? module.exports :
                   typeof module.exports === 'object' && module.exports.default ? module.exports.default :
                   exports.default || exports;
          `);

          const fakeModule = { exports: {} };
          const fakeRequire = () => ({});

          return componentFunction(fakeRequire, fakeModule, fakeModule.exports);
        }
      };
    }
    return this._defaultLoader;
  }

  /**
   * Validar dependencias de una app
   * @param {Array} imports - Lista de imports
   * @param {Map} availableApps - Apps disponibles
   * @returns {Object} Resultado de validación
   */
  validate(imports, availableApps) {
    const result = {
      valid: [],
      invalid: [],
      missing: [],
      circular: []
    };

    for (const importPath of imports) {
      const [appName, componentName] = importPath.split('.');

      // Validar formato
      if (!appName || !componentName) {
        result.invalid.push({
          import: importPath,
          reason: 'Invalid format. Use "app.component"'
        });
        continue;
      }

      // Validar que la app existe
      const app = availableApps.get(appName);
      if (!app) {
        result.missing.push({
          import: importPath,
          app: appName,
          reason: 'App not registered'
        });
        continue;
      }

      // Validar que el export existe
      const manifest = app.manifest;
      const exportExists = manifest?.wu?.exports?.[componentName];

      if (!exportExists) {
        result.invalid.push({
          import: importPath,
          reason: `Component ${componentName} not exported by ${appName}`
        });
        continue;
      }

      result.valid.push({
        import: importPath,
        app: appName,
        component: componentName,
        path: exportExists
      });
    }

    // Detectar dependencias circulares
    result.circular = this.detectCircularDependencies(imports, availableApps);

    return result;
  }

  /**
   * Detectar dependencias circulares
   * @param {Array} imports - Lista de imports
   * @param {Map} availableApps - Apps disponibles
   * @returns {Array} Dependencias circulares encontradas
   */
  detectCircularDependencies(imports, availableApps) {
    const circular = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (appName, path = []) => {
      if (visiting.has(appName)) {
        // Encontrada dependencia circular
        const circularPath = [...path, appName];
        circular.push(circularPath);
        return;
      }

      if (visited.has(appName)) {
        return;
      }

      visiting.add(appName);
      const currentPath = [...path, appName];

      // Buscar las dependencias de esta app
      const app = availableApps.get(appName);
      if (app && app.manifest?.wu?.imports) {
        for (const importPath of app.manifest.wu.imports) {
          const [depAppName] = importPath.split('.');
          if (depAppName) {
            visit(depAppName, currentPath);
          }
        }
      }

      visiting.delete(appName);
      visited.add(appName);
    };

    // Visitar todas las apps
    for (const app of availableApps.keys()) {
      visit(app);
    }

    return circular;
  }

  /**
   * Crear wrapper para componente compartido
   * @param {Function} component - Componente original
   * @param {string} importPath - Ruta de import
   * @returns {Function} Componente wrapper
   */
  createComponentWrapper(component, importPath) {
    return function WuSharedComponent(props) {
      logger.debug(`[WuDependencyResolver] 🧩 Rendering shared component: ${importPath}`);

      try {
        return component(props);
      } catch (error) {
        console.error(`[WuDependencyResolver] ❌ Error in shared component ${importPath}:`, error);

        // Componente de error fallback
        return {
          type: 'div',
          props: {
            style: {
              padding: '10px',
              border: '1px solid #ff6b6b',
              borderRadius: '4px',
              background: '#ffe0e0',
              color: '#d63031'
            },
            children: `Error in shared component: ${importPath}`
          }
        };
      }
    };
  }

  /**
   * Limpiar cache de dependencias
   * @param {string} pattern - Patrón opcional
   */
  clearCache(pattern) {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const [importPath] of this.resolvedComponents) {
        if (regex.test(importPath)) {
          this.resolvedComponents.delete(importPath);
          logger.debug(`[WuDependencyResolver] 🗑️ Cleared cache for: ${importPath}`);
        }
      }
    } else {
      this.resolvedComponents.clear();
      logger.debug(`[WuDependencyResolver] 🗑️ Dependency cache cleared completely`);
    }
  }

  /**
   * Obtener estadísticas del resolver
   */
  getStats() {
    return {
      resolved: this.resolvedComponents.size,
      pending: this.pendingResolutions.size,
      components: Array.from(this.resolvedComponents.keys())
    };
  }
}