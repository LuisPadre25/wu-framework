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

/**
 * @typedef {Object} WuEvent
 * @property {string} name - Event name
 * @property {*} data - Event payload
 * @property {number} timestamp - Event timestamp
 * @property {string} appName - Source app name
 * @property {Object} meta - Additional metadata
 * @property {boolean} verified - Whether origin was verified
 */

/**
 * @typedef {Object} WuEventBusConfig
 * @property {number} [maxHistory=100] - Maximum events in history
 * @property {boolean} [enableReplay=true] - Enable event replay
 * @property {boolean} [enableWildcards=true] - Enable wildcard matching
 * @property {boolean} [logEvents=false] - Log all events
 * @property {boolean} [strictMode=false] - Reject unauthorized events
 * @property {boolean} [validateOrigin=true] - Validate event origins
 */

export class WuEventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];

    // 🔐 SEGURIDAD: Registro de apps autorizadas con tokens
    this.authorizedApps = new Map(); // appName -> { token, permissions }
    this.trustedEvents = new Set(['wu:*', 'system:*']); // Eventos del sistema

    // Auto-detect production environment for strictMode default
    const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

    this.config = {
      maxHistory: 100,
      enableReplay: true,
      enableWildcards: true,
      logEvents: false,
      // 🔐 Opciones de seguridad
      strictMode: isProduction, // Auto-enabled in production, permissive in development
      validateOrigin: true // Valida que appName sea una app registrada
    };

    this._permissiveWarned = false;

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
   * WARN PERMISSIVE MODE: Log a one-time warning when strictMode is off
   * Alerts developers that events are flowing without authorization checks
   */
  _warnPermissiveMode() {
    if (this._permissiveWarned) return;
    this._permissiveWarned = true;
    logger.warn(
      '[WuEventBus] strictMode is disabled. Events are emitted without authorization checks. ' +
      'Enable strictMode for production by calling enableStrictMode() or setting NODE_ENV=production.'
    );
  }

  /**
   * 📢 EMIT: Emitir evento con validación de origen
   * @param {string} eventName - Nombre del evento
   * @param {*} data - Datos del evento
   * @param {Object} options - { appName, timestamp, meta, token }
   */
  emit(eventName, data, options = {}) {
    const appName = options.appName || 'unknown';

    // Warn once if running in permissive mode (strictMode off)
    if (!this.config.strictMode) {
      this._warnPermissiveMode();
    }

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
