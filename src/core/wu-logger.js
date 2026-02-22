/**
 * 📝 WU-LOGGER: Sistema de logging inteligente para entornos
 * Controla los logs automáticamente según el entorno
 */

export class WuLogger {
  constructor() {
    // Detectar entorno automáticamente
    this.isDevelopment = this.detectEnvironment();
    // En desarrollo: warn (menos ruido), en producción: error
    this.logLevel = this.isDevelopment ? 'warn' : 'error';

    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      silent: 4
    };
  }

  /**
   * Detectar si estamos en desarrollo
   */
  detectEnvironment() {
    // Múltiples formas de detectar desarrollo
    return (
      // Vite development
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port !== '' ||
      // NODE_ENV si está disponible
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ||
      // URL params para forzar debug
      new URLSearchParams(window.location.search).has('wu-debug') ||
      // Manual override
      window.WU_DEBUG === true
    );
  }

  /**
   * Configurar nivel de logging
   */
  setLevel(level) {
    this.logLevel = level;
    return this;
  }

  /**
   * Habilitar/deshabilitar development mode
   */
  setDevelopment(isDev) {
    this.isDevelopment = isDev;
    this.logLevel = isDev ? 'debug' : 'error';
    return this;
  }

  /**
   * Verificar si debemos mostrar el log
   */
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  /**
   * Logging methods
   */
  debug(...args) {
    if (this.shouldLog('debug')) {
      console.log(...args);
    }
  }

  info(...args) {
    if (this.shouldLog('info')) {
      console.info(...args);
    }
  }

  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn(...args);
    }
  }

  error(...args) {
    if (this.shouldLog('error')) {
      console.error(...args);
    }
  }

  /**
   * Logging con contexto Wu
   */
  wu(level, ...args) {
    if (this.shouldLog(level)) {
      const method = level === 'debug' ? 'log' : level;
      console[method]('[Wu]', ...args);
    }
  }

  /**
   * Helper methods específicos para Wu
   */
  wuDebug(...args) { this.wu('debug', ...args); }
  wuInfo(...args) { this.wu('info', ...args); }
  wuWarn(...args) { this.wu('warn', ...args); }
  wuError(...args) { this.wu('error', ...args); }
}

// Singleton instance
export const logger = new WuLogger();

// Helper para compatibilidad con logs existentes
export const wuLog = {
  debug: (...args) => logger.wuDebug(...args),
  info: (...args) => logger.wuInfo(...args),
  warn: (...args) => logger.wuWarn(...args),
  error: (...args) => logger.wuError(...args)
};

/**
 * 🔇 Silenciar todos los logs de Wu Framework
 * Útil en producción para eliminar todo el ruido
 */
export function silenceAllLogs() {
  logger.setLevel('silent');
}

/**
 * 🔊 Restaurar logs (nivel debug)
 */
export function enableAllLogs() {
  logger.setLevel('debug');
}