/**
 * 🔌 WU-PLUGIN: SECURE PLUGIN SYSTEM
 *
 * Sistema de plugins con sandboxing de seguridad
 * - Plugin lifecycle (install, beforeMount, afterMount, etc.)
 * - Sandboxed API (plugins no tienen acceso completo al core)
 * - Permission system
 * - Timeout protection
 */
import { logger } from './wu-logger.js';


export class WuPluginSystem {
  constructor(core) {
    this._core = core; // Privado - no expuesto a plugins
    this.plugins = new Map();
    this.hooks = new Map();

    // Hooks disponibles
    this.availableHooks = [
      'beforeInit', 'afterInit',
      'beforeMount', 'afterMount',
      'beforeUnmount', 'afterUnmount',
      'onError', 'onDestroy'
    ];

    // 🔐 Permisos disponibles
    this.availablePermissions = [
      'mount',      // Puede montar/desmontar apps
      'events',     // Puede emitir/escuchar eventos
      'store',      // Puede leer/escribir store
      'apps',       // Puede ver lista de apps
      'config',     // Puede modificar configuración
      'unsafe'      // Acceso completo (peligroso)
    ];

    // 🔐 Timeout para hooks (evita que plugins bloqueen)
    this.hookTimeout = 5000; // 5 segundos

    this.availableHooks.forEach(hook => {
      this.hooks.set(hook, []);
    });
  }

  /**
   * 🔐 CREATE SANDBOXED API: Crea API limitada para el plugin
   * @param {Array} permissions - Permisos del plugin
   * @returns {Object} API sandboxeada
   */
  _createSandboxedApi(permissions) {
    const api = {
      // Info básica siempre disponible
      version: this._core.version,
      info: this._core.info,

      // 📊 Métodos de solo lectura
      getAppInfo: (appName) => {
        const mounted = this._core.mounted.get(appName);
        if (!mounted) return null;
        return {
          name: appName,
          state: mounted.state,
          timestamp: mounted.timestamp
        };
      },

      getMountedApps: () => {
        return Array.from(this._core.mounted.keys());
      },

      getStats: () => this._core.getStats()
    };

    // 🔐 Agregar métodos según permisos
    if (permissions.includes('events') || permissions.includes('unsafe')) {
      api.emit = (event, data) => this._core.eventBus.emit(event, data, { appName: 'plugin' });
      api.on = (event, cb) => this._core.eventBus.on(event, cb);
      api.off = (event, cb) => this._core.eventBus.off(event, cb);
    }

    if (permissions.includes('store') || permissions.includes('unsafe')) {
      api.getState = (path) => this._core.store.get(path);
      api.setState = (path, value) => this._core.store.set(path, value);
    }

    if (permissions.includes('mount') || permissions.includes('unsafe')) {
      api.mount = (appName, container) => this._core.mount(appName, container);
      api.unmount = (appName) => this._core.unmount(appName);
    }

    if (permissions.includes('config') || permissions.includes('unsafe')) {
      api.configure = (config) => {
        // Solo permitir configuración segura
        const safeKeys = ['debug', 'logLevel'];
        const safeConfig = {};
        for (const key of safeKeys) {
          if (key in config) safeConfig[key] = config[key];
        }
        Object.assign(this._core, safeConfig);
      };
    }

    // 🚨 Acceso completo solo con permiso 'unsafe'
    if (permissions.includes('unsafe')) {
      api._unsafeCore = this._core;
      logger.warn('[WuPlugin] ⚠️ Plugin has unsafe access to core!');
    }

    // Congelar API para evitar modificaciones
    return Object.freeze(api);
  }

  /**
   * 🔐 VALIDATE PLUGIN: Validar estructura del plugin
   * @param {Object} plugin
   * @returns {boolean}
   */
  _validatePlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('[WuPlugin] Invalid plugin: must be an object');
    }

    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new Error('[WuPlugin] Invalid plugin: must have a name (string)');
    }

    if (plugin.name.length > 50) {
      throw new Error('[WuPlugin] Invalid plugin: name too long (max 50 chars)');
    }

    // Validar que los hooks sean funciones
    for (const hookName of this.availableHooks) {
      if (plugin[hookName] && typeof plugin[hookName] !== 'function') {
        throw new Error(`[WuPlugin] Invalid plugin: ${hookName} must be a function`);
      }
    }

    // Validar permisos
    if (plugin.permissions) {
      if (!Array.isArray(plugin.permissions)) {
        throw new Error('[WuPlugin] Invalid plugin: permissions must be an array');
      }

      for (const perm of plugin.permissions) {
        if (!this.availablePermissions.includes(perm)) {
          throw new Error(`[WuPlugin] Invalid permission: ${perm}`);
        }
      }
    }

    return true;
  }

  /**
   * 📦 USE: Instalar plugin con sandboxing
   * @param {Object|Function} plugin - Plugin o factory function
   * @param {Object} options - Opciones del plugin
   */
  use(plugin, options = {}) {
    // Si es una función, ejecutarla para obtener el plugin
    // Nota: factory functions NO reciben acceso al core
    if (typeof plugin === 'function') {
      plugin = plugin(options);
    }

    // Validar plugin
    this._validatePlugin(plugin);

    // Verificar si ya está instalado
    if (this.plugins.has(plugin.name)) {
      logger.warn(`[WuPlugin] Plugin "${plugin.name}" already installed`);
      return;
    }

    // Determinar permisos (por defecto: solo eventos)
    const permissions = plugin.permissions || ['events'];

    // 🔐 Crear API sandboxeada
    const sandboxedApi = this._createSandboxedApi(permissions);

    // Ejecutar install del plugin con API sandboxeada
    if (plugin.install) {
      try {
        plugin.install(sandboxedApi, options);
      } catch (error) {
        console.error(`[WuPlugin] Error installing "${plugin.name}":`, error);
        throw error;
      }
    }

    // Registrar hooks del plugin con protección
    this.availableHooks.forEach(hookName => {
      if (typeof plugin[hookName] === 'function') {
        // Wrap el hook con timeout y try-catch
        const wrappedHook = this._wrapHook(plugin[hookName].bind(plugin), plugin.name, hookName);
        this.registerHook(hookName, wrappedHook);
      }
    });

    // Guardar plugin
    this.plugins.set(plugin.name, {
      plugin,
      options,
      permissions,
      sandboxedApi,
      installedAt: Date.now()
    });

    logger.debug(`[WuPlugin] ✅ Plugin "${plugin.name}" installed (permissions: ${permissions.join(', ')})`);
  }

  /**
   * 🔐 WRAP HOOK: Envolver hook con timeout y error handling
   */
  _wrapHook(hookFn, pluginName, hookName) {
    return async (context) => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Plugin "${pluginName}" hook "${hookName}" timed out after ${this.hookTimeout}ms`));
        }, this.hookTimeout);
      });

      try {
        // Race entre el hook y el timeout
        return await Promise.race([
          hookFn(context),
          timeoutPromise
        ]);
      } catch (error) {
        console.error(`[WuPlugin] Error in ${pluginName}.${hookName}:`, error);
        // No propagar error para no romper otros plugins
        return undefined;
      }
    };
  }

  /**
   * 🪝 REGISTER HOOK
   */
  registerHook(hookName, callback) {
    if (!this.hooks.has(hookName)) {
      logger.warn(`[WuPlugin] Unknown hook: ${hookName}`);
      return;
    }
    this.hooks.get(hookName).push(callback);
  }

  /**
   * 🎯 CALL HOOK
   */
  async callHook(hookName, context) {
    const callbacks = this.hooks.get(hookName) || [];

    for (const callback of callbacks) {
      try {
        const result = await callback(context);
        if (result === false) {
          return false;
        }
      } catch (error) {
        console.error(`[WuPlugin] Error in hook ${hookName}:`, error);
      }
    }

    return true;
  }

  /**
   * 🗑️ UNINSTALL
   */
  uninstall(pluginName) {
    const pluginData = this.plugins.get(pluginName);
    if (!pluginData) {
      logger.warn(`[WuPlugin] Plugin "${pluginName}" not found`);
      return;
    }

    const { plugin, sandboxedApi } = pluginData;

    if (plugin.uninstall) {
      try {
        plugin.uninstall(sandboxedApi);
      } catch (error) {
        console.error(`[WuPlugin] Error uninstalling "${pluginName}":`, error);
      }
    }

    this.plugins.delete(pluginName);
    logger.debug(`[WuPlugin] ✅ Plugin "${pluginName}" uninstalled`);
  }

  /**
   * 📋 GET PLUGIN
   */
  getPlugin(pluginName) {
    return this.plugins.get(pluginName)?.plugin;
  }

  /**
   * 📊 GET STATS
   */
  getStats() {
    return {
      totalPlugins: this.plugins.size,
      plugins: Array.from(this.plugins.entries()).map(([name, data]) => ({
        name,
        permissions: data.permissions,
        installedAt: data.installedAt
      })),
      hooks: Array.from(this.hooks.entries()).map(([name, callbacks]) => ({
        name,
        callbacks: callbacks.length
      }))
    };
  }

  /**
   * 🧹 CLEANUP
   */
  cleanup() {
    for (const [name] of this.plugins) {
      this.uninstall(name);
    }
  }
}

/**
 * 📦 PLUGIN HELPER: Helper para crear plugins
 * @param {Object} config - Configuración del plugin
 * @param {string} config.name - Nombre del plugin
 * @param {Array} config.permissions - Permisos requeridos
 */
export const createPlugin = (config) => {
  return {
    name: config.name,
    permissions: config.permissions || ['events'],
    install: config.install,
    uninstall: config.uninstall,
    beforeInit: config.beforeInit,
    afterInit: config.afterInit,
    beforeMount: config.beforeMount,
    afterMount: config.afterMount,
    beforeUnmount: config.beforeUnmount,
    afterUnmount: config.afterUnmount,
    onError: config.onError,
    onDestroy: config.onDestroy
  };
};
