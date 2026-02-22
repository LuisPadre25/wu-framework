/**
 * 📡 WU-EVENT-BUS: SECURE PUB/SUB SYSTEM
 *
 * Sistema de eventos para comunicación entre microfrontends
 * - Pub/Sub pattern con validación de origen
 * - Event namespaces
 * - Wildcards
 * - Event replay
 * - Verificación de apps autorizadas
 */
import { logger } from './wu-logger.js';


export class WuEventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];

    // 🔐 SEGURIDAD: Registro de apps autorizadas con tokens
    this.authorizedApps = new Map(); // appName -> { token, permissions }
    this.trustedEvents = new Set(['wu:*', 'system:*']); // Eventos del sistema

    this.config = {
      maxHistory: 100,
      enableReplay: true,
      enableWildcards: true,
      logEvents: false,
      // 🔐 Opciones de seguridad
      strictMode: false, // Si true, rechaza eventos de apps no autorizadas
      validateOrigin: true // Valida que appName sea una app registrada
    };

    this.stats = {
      emitted: 0,
      subscriptions: 0,
      rejected: 0 // Eventos rechazados por seguridad
    };
  }

  /**
   * 🔐 REGISTER APP: Registrar app autorizada para emitir eventos
   * @param {string} appName - Nombre de la app
   * @param {Object} options - { permissions: ['event:*'], token }
   * @returns {string} Token de autorización
   */
  registerApp(appName, options = {}) {
    const token = options.token || this._generateToken();

    this.authorizedApps.set(appName, {
      token,
      permissions: options.permissions || ['*'], // Por defecto puede emitir todo
      registeredAt: Date.now()
    });

    return token;
  }

  /**
   * 🔓 UNREGISTER APP: Desregistrar app
   * @param {string} appName
   */
  unregisterApp(appName) {
    this.authorizedApps.delete(appName);
  }

  /**
   * 🔐 VALIDATE ORIGIN: Verificar que el emisor está autorizado
   * @param {string} eventName
   * @param {string} appName
   * @param {string} token
   * @returns {boolean}
   */
  _validateOrigin(eventName, appName, token) {
    // Eventos del sistema siempre permitidos
    if (this._isSystemEvent(eventName)) {
      return true;
    }

    // Si no está en modo estricto, permitir todo
    if (!this.config.strictMode) {
      return true;
    }

    // Verificar que la app esté registrada
    const appInfo = this.authorizedApps.get(appName);
    if (!appInfo) {
      return false;
    }

    // Verificar token si se proporciona
    if (token && appInfo.token !== token) {
      return false;
    }

    // Verificar permisos
    return this._hasPermission(appInfo.permissions, eventName);
  }

  /**
   * 🔐 HAS PERMISSION: Verificar si la app tiene permiso para el evento
   */
  _hasPermission(permissions, eventName) {
    if (permissions.includes('*')) return true;

    return permissions.some(pattern => {
      if (pattern === eventName) return true;
      if (pattern.includes('*')) {
        return this.matchesWildcard(eventName, pattern);
      }
      return false;
    });
  }

  /**
   * 🔐 IS SYSTEM EVENT: Verificar si es un evento del sistema
   */
  _isSystemEvent(eventName) {
    return eventName.startsWith('wu:') ||
           eventName.startsWith('system:') ||
           eventName.startsWith('app:');
  }

  /**
   * 🔐 GENERATE TOKEN: Generar token único
   */
  _generateToken() {
    return `wu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 📢 EMIT: Emitir evento con validación de origen
   * @param {string} eventName - Nombre del evento
   * @param {*} data - Datos del evento
   * @param {Object} options - { appName, timestamp, meta, token }
   */
  emit(eventName, data, options = {}) {
    const appName = options.appName || 'unknown';

    // 🔐 Validar origen si está habilitado
    if (this.config.validateOrigin && this.config.strictMode) {
      if (!this._validateOrigin(eventName, appName, options.token)) {
        this.stats.rejected++;
        logger.warn(`[WuEventBus] 🚫 Event rejected: ${eventName} from ${appName} (unauthorized)`);
        return false;
      }
    }

    const event = {
      name: eventName,
      data,
      timestamp: options.timestamp || Date.now(),
      appName,
      meta: options.meta || {},
      // 🔐 Marcar si el origen fue verificado
      verified: this.authorizedApps.has(appName)
    };

    // Agregar a historial
    if (this.config.enableReplay) {
      this.addToHistory(event);
    }

    // Log si está habilitado
    if (this.config.logEvents) {
      logger.debug(`[WuEventBus] 📢 ${eventName}`, data);
    }

    // Notificar listeners exactos
    const exactListeners = this.listeners.get(eventName);
    if (exactListeners) {
      exactListeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error(`[WuEventBus] ❌ Error in listener for ${eventName}:`, error);
        }
      });
    }

    // Notificar listeners con wildcards
    if (this.config.enableWildcards) {
      this.notifyWildcardListeners(eventName, event);
    }

    this.stats.emitted++;
    return true;
  }

  /**
   * 👂 ON: Suscribirse a evento
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }

    this.listeners.get(eventName).add(callback);
    this.stats.subscriptions++;

    return () => this.off(eventName, callback);
  }

  /**
   * 🔇 OFF: Desuscribirse de evento
   */
  off(eventName, callback) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(eventName);
      }
      this.stats.subscriptions--;
    }
  }

  /**
   * 🎯 ONCE: Suscribirse una sola vez
   */
  once(eventName, callback) {
    const wrappedCallback = (event) => {
      callback(event);
      this.off(eventName, wrappedCallback);
    };
    return this.on(eventName, wrappedCallback);
  }

  /**
   * 🌟 WILDCARD LISTENERS
   */
  notifyWildcardListeners(eventName, event) {
    for (const [pattern, listeners] of this.listeners) {
      if (this.matchesWildcard(eventName, pattern)) {
        listeners.forEach(callback => {
          try {
            callback(event);
          } catch (error) {
            console.error(`[WuEventBus] ❌ Error in wildcard listener for ${pattern}:`, error);
          }
        });
      }
    }
  }

  /**
   * 🎯 MATCHES WILDCARD
   */
  matchesWildcard(eventName, pattern) {
    if (!pattern.includes('*')) return false;
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(eventName);
  }

  /**
   * 📝 ADD TO HISTORY
   */
  addToHistory(event) {
    this.history.push(event);
    if (this.history.length > this.config.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * 🔄 REPLAY
   */
  replay(eventNameOrPattern, callback) {
    const events = this.history.filter(event => {
      if (eventNameOrPattern.includes('*')) {
        return this.matchesWildcard(event.name, eventNameOrPattern);
      }
      return event.name === eventNameOrPattern;
    });

    events.forEach(event => {
      try {
        callback(event);
      } catch (error) {
        console.error(`[WuEventBus] ❌ Error replaying event:`, error);
      }
    });
  }

  /**
   * 🧹 CLEAR HISTORY
   */
  clearHistory(eventNameOrPattern) {
    if (!eventNameOrPattern) {
      this.history = [];
      return;
    }

    this.history = this.history.filter(event => {
      if (eventNameOrPattern.includes('*')) {
        return !this.matchesWildcard(event.name, eventNameOrPattern);
      }
      return event.name !== eventNameOrPattern;
    });
  }

  /**
   * 📊 GET STATS
   */
  getStats() {
    return {
      ...this.stats,
      activeListeners: this.listeners.size,
      historySize: this.history.length,
      authorizedApps: this.authorizedApps.size,
      listenersByEvent: Array.from(this.listeners.entries()).map(([event, listeners]) => ({
        event,
        listeners: listeners.size
      }))
    };
  }

  /**
   * ⚙️ CONFIGURE
   */
  configure(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * 🔐 ENABLE STRICT MODE: Activar modo estricto de seguridad
   */
  enableStrictMode() {
    this.config.strictMode = true;
  }

  /**
   * 🔓 DISABLE STRICT MODE
   */
  disableStrictMode() {
    this.config.strictMode = false;
  }

  /**
   * 🗑️ REMOVE ALL
   */
  removeAll() {
    this.listeners.clear();
    this.stats.subscriptions = 0;
  }
}
