/**
 * 🛡️ WU-ERROR-BOUNDARY: ADVANCED ERROR HANDLING
 *
 * Sistema de error boundaries con:
 * - Chain of Responsibility pattern
 * - Recovery strategies
 * - Error classification
 * - Fallback rendering
 */

import { logger } from './wu-logger.js';

export class WuErrorBoundary {
  constructor(core) {
    this.core = core;
    this.handlers = [];
    this.errorLog = [];
    this.maxErrorLog = 100;

    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      showErrorUI: true
    };

    this.registerDefaultHandlers();

    logger.debug('[WuErrorBoundary] 🛡️ Error boundary initialized');
  }

  /**
   * 📋 REGISTER DEFAULT HANDLERS: Chain of responsibility
   */
  registerDefaultHandlers() {
    // 1. Network Error Handler
    this.register({
      name: 'network',
      canHandle: (error) => {
        return error.name === 'TypeError' &&
               (error.message.includes('fetch') || error.message.includes('network'));
      },
      handle: async (error, context) => {
        logger.debug('[ErrorHandler:Network] Handling network error');

        // Retry con backoff
        if (context.retryCount < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, context.retryCount);
          logger.debug(`[ErrorHandler:Network] Retrying in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));

          return {
            recovered: true,
            action: 'retry',
            retryCount: context.retryCount + 1
          };
        }

        return {
          recovered: false,
          action: 'fallback',
          message: 'Network error: Please check your connection'
        };
      }
    });

    // 2. Script Load Error Handler
    this.register({
      name: 'script-load',
      canHandle: (error) => {
        return error.name === 'Error' &&
               (error.message.includes('Loading') ||
                error.message.includes('Failed to fetch'));
      },
      handle: async (error, context) => {
        logger.debug('[ErrorHandler:ScriptLoad] Handling script load error');

        // Intentar URL alternativa si existe
        if (context.fallbackUrl) {
          logger.debug('[ErrorHandler:ScriptLoad] Trying fallback URL');
          return {
            recovered: true,
            action: 'use-fallback-url',
            url: context.fallbackUrl
          };
        }

        return {
          recovered: false,
          action: 'fallback',
          message: 'Failed to load microfrontend'
        };
      }
    });

    // 3. Mount Error Handler
    this.register({
      name: 'mount',
      canHandle: (error) => {
        return error.message && error.message.includes('mount');
      },
      handle: async (error, context) => {
        logger.debug('[ErrorHandler:Mount] Handling mount error');

        // Limpiar y reintentar
        if (context.retryCount < 2) {
          logger.debug('[ErrorHandler:Mount] Cleaning up and retrying...');

          // Cleanup
          try {
            await this.core.unmount(context.appName);
          } catch (cleanupError) {
            logger.warn('[ErrorHandler:Mount] Cleanup failed:', cleanupError);
          }

          await new Promise(resolve => setTimeout(resolve, 500));

          return {
            recovered: true,
            action: 'retry',
            retryCount: context.retryCount + 1
          };
        }

        return {
          recovered: false,
          action: 'fallback',
          message: 'Failed to mount application'
        };
      }
    });

    // 4. Timeout Error Handler
    this.register({
      name: 'timeout',
      canHandle: (error) => {
        return error.name === 'TimeoutError' ||
               error.message.includes('timeout');
      },
      handle: async (error, context) => {
        logger.debug('[ErrorHandler:Timeout] Handling timeout error');

        // Aumentar timeout y reintentar
        if (context.retryCount < 2) {
          return {
            recovered: true,
            action: 'retry-with-longer-timeout',
            timeout: (context.timeout || 5000) * 2,
            retryCount: context.retryCount + 1
          };
        }

        return {
          recovered: false,
          action: 'fallback',
          message: 'Operation timed out'
        };
      }
    });

    // 5. Generic Error Handler (fallback)
    this.register({
      name: 'generic',
      canHandle: () => true, // Maneja todo
      handle: async (error, context) => {
        logger.debug('[ErrorHandler:Generic] Handling generic error');

        return {
          recovered: false,
          action: 'fallback',
          message: error.message || 'An unexpected error occurred'
        };
      }
    });
  }

  /**
   * 📦 REGISTER: Registrar error handler
   * @param {Object} handler - Error handler { name, canHandle, handle }
   */
  register(handler) {
    if (!handler.name || !handler.canHandle || !handler.handle) {
      throw new Error('[WuErrorBoundary] Handler must have name, canHandle, and handle');
    }

    this.handlers.push(handler);
    logger.debug(`[WuErrorBoundary] Handler "${handler.name}" registered`);
  }

  /**
   * 🎯 HANDLE: Manejar error con chain of responsibility
   * @param {Error} error - Error a manejar
   * @param {Object} context - Contexto del error
   * @returns {Promise<Object>} Recovery result
   */
  async handle(error, context = {}) {
    // Agregar valores por defecto
    context = {
      retryCount: 0,
      timestamp: Date.now(),
      ...context
    };

    // Log error
    this.logError(error, context);

    // Buscar handler que pueda manejar este error
    for (const handler of this.handlers) {
      try {
        if (handler.canHandle(error, context)) {
          logger.debug(`[WuErrorBoundary] Using handler: ${handler.name}`);

          const result = await handler.handle(error, context);

          if (result.recovered) {
            logger.debug(`[WuErrorBoundary] ✅ Error recovered by ${handler.name}`);
            return result;
          }

          // Si no se recuperó, renderizar fallback
          if (result.action === 'fallback' && this.config.showErrorUI) {
            this.renderFallback(context, result);
          }

          return result;
        }
      } catch (handlerError) {
        console.error(`[WuErrorBoundary] Handler "${handler.name}" failed:`, handlerError);
      }
    }

    // No handler pudo manejar el error
    console.error('[WuErrorBoundary] ❌ No handler could handle the error');

    return {
      recovered: false,
      action: 'unhandled',
      message: 'Unhandled error'
    };
  }

  /**
   * 🎨 RENDER FALLBACK: Renderizar UI de error
   * @param {Object} context - Contexto del error
   * @param {Object} result - Resultado del handler
   */
  renderFallback(context, result) {
    if (!context.container) {
      logger.warn('[WuErrorBoundary] No container to render fallback');
      return;
    }

    const container = typeof context.container === 'string'
      ? document.querySelector(context.container)
      : context.container;

    if (!container) return;

    // Limpiar container
    container.innerHTML = '';

    // Crear UI de error
    const errorUI = document.createElement('div');
    errorUI.className = 'wu-error-boundary';

    Object.assign(errorUI.style, {
      padding: '2rem',
      borderRadius: '8px',
      background: '#fff3cd',
      border: '1px solid #ffc107',
      color: '#856404',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'center'
    });

    const icon = document.createElement('div');
    icon.textContent = '⚠️';
    icon.style.fontSize = '3rem';
    icon.style.marginBottom = '1rem';

    const title = document.createElement('h3');
    title.textContent = 'Application Error';
    title.style.margin = '0 0 0.5rem 0';

    const message = document.createElement('p');
    message.textContent = result.message || 'An error occurred';
    message.style.margin = '0 0 1rem 0';

    const button = document.createElement('button');
    button.textContent = '🔄 Reload';
    Object.assign(button.style, {
      padding: '0.5rem 1rem',
      background: '#ffc107',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontWeight: 'bold',
      color: '#000'
    });

    button.addEventListener('click', () => window.location.reload());

    errorUI.appendChild(icon);
    errorUI.appendChild(title);
    errorUI.appendChild(message);
    errorUI.appendChild(button);

    container.appendChild(errorUI);
  }

  /**
   * 📝 LOG ERROR: Registrar error
   * @param {Error} error - Error
   * @param {Object} context - Contexto
   */
  logError(error, context) {
    // Truncate stack to first 5 lines to prevent retaining large object references
    const stack = error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : '';

    // Shallow-copy context to avoid retaining references to live objects
    const safeContext = {};
    for (const key of Object.keys(context)) {
      const val = context[key];
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null) {
        safeContext[key] = val;
      } else {
        safeContext[key] = String(val);
      }
    }

    const errorEntry = {
      error: {
        name: error.name,
        message: error.message,
        stack
      },
      context: safeContext,
      timestamp: Date.now()
    };

    this.errorLog.push(errorEntry);

    // Maintain log limit
    if (this.errorLog.length > this.maxErrorLog) {
      this.errorLog.shift();
    }
  }

  /**
   * 📋 GET ERROR LOG: Obtener log de errores
   * @param {number} limit - Límite de errores a retornar
   * @returns {Array}
   */
  getErrorLog(limit = 10) {
    return this.errorLog.slice(-limit);
  }

  /**
   * 📊 GET STATS: Estadísticas de errores
   * @returns {Object}
   */
  getStats() {
    const errorsByType = {};

    this.errorLog.forEach(entry => {
      const type = entry.error.name || 'Unknown';
      errorsByType[type] = (errorsByType[type] || 0) + 1;
    });

    return {
      totalErrors: this.errorLog.length,
      handlers: this.handlers.length,
      errorsByType,
      recentErrors: this.getErrorLog(5)
    };
  }

  /**
   * ⚙️ CONFIGURE: Configurar error boundary
   * @param {Object} config - Nueva configuración
   */
  configure(config) {
    this.config = {
      ...this.config,
      ...config
    };
  }

  /**
   * 🧹 CLEANUP: Limpiar error boundary
   */
  cleanup() {
    this.errorLog = [];
    logger.debug('[WuErrorBoundary] 🧹 Error boundary cleaned up');
  }
}
