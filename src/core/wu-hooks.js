/**
 * 🪝 WU-HOOKS: LIFECYCLE MIDDLEWARE SYSTEM
 *
 * Sistema de hooks basado en middleware pattern para control fino:
 * - Middleware chain con next()
 * - Puede cancelar operaciones (no llamar next)
 * - Puede modificar contexto
 * - Prioridad de hooks
 * - Async/await support
 */

import { logger } from './wu-logger.js';

export class WuLifecycleHooks {
  constructor(core) {
    this.core = core;
    this.hooks = new Map();
    this.executionLog = [];
    this.maxLogSize = 100;

    // Lifecycle phases disponibles
    this.lifecyclePhases = [
      'beforeInit',      // Antes de inicializar framework
      'afterInit',       // Después de inicializar
      'beforeLoad',      // Antes de cargar una app
      'afterLoad',       // Después de cargar
      'beforeMount',     // Antes de montar
      'afterMount',      // Después de montar
      'beforeUnmount',   // Antes de desmontar
      'afterUnmount',    // Después de desmontar
      'beforeDestroy',   // Antes de destruir framework
      'afterDestroy'     // Después de destruir
    ];

    // Inicializar hooks
    this.lifecyclePhases.forEach(phase => {
      this.hooks.set(phase, []);
    });

    logger.debug('[WuHooks] 🪝 Lifecycle hooks initialized');
  }

  /**
   * 📦 USE: Registrar middleware hook
   * @param {string} phase - Fase del lifecycle
   * @param {Function} middleware - Función middleware (context, next)
   * @param {Object} options - { priority, name }
   */
  use(phase, middleware, options = {}) {
    if (!this.hooks.has(phase)) {
      throw new Error(`[WuHooks] Unknown lifecycle phase: ${phase}`);
    }

    if (typeof middleware !== 'function') {
      throw new Error('[WuHooks] Middleware must be a function');
    }

    const hook = {
      middleware,
      name: options.name || `hook_${Date.now()}`,
      priority: options.priority || 0,
      registeredAt: Date.now()
    };

    const hooks = this.hooks.get(phase);
    hooks.push(hook);

    // Ordenar por prioridad (mayor primero)
    hooks.sort((a, b) => b.priority - a.priority);

    logger.debug(`[WuHooks] Hook "${hook.name}" registered for ${phase} (priority: ${hook.priority})`);

    // Retornar función para desregistrar
    return () => this.remove(phase, hook.name);
  }

  /**
   * 🗑️ REMOVE: Remover hook
   * @param {string} phase - Fase del lifecycle
   * @param {string} name - Nombre del hook
   */
  remove(phase, name) {
    if (!this.hooks.has(phase)) return;

    const hooks = this.hooks.get(phase);
    const index = hooks.findIndex(h => h.name === name);

    if (index > -1) {
      hooks.splice(index, 1);
      logger.debug(`[WuHooks] Hook "${name}" removed from ${phase}`);
    }
  }

  /**
   * 🎯 EXECUTE: Ejecutar middleware chain
   * @param {string} phase - Fase del lifecycle
   * @param {Object} context - Contexto a pasar
   * @returns {Promise<Object>} Contexto modificado o { cancelled: true }
   */
  async execute(phase, context = {}) {
    const hooks = this.hooks.get(phase);

    if (!hooks || hooks.length === 0) {
      return context;
    }

    logger.debug(`[WuHooks] Executing ${hooks.length} hooks for ${phase}`);

    // Log para debugging
    const executionEntry = {
      phase,
      timestamp: Date.now(),
      hooksCount: hooks.length,
      hookNames: hooks.map(h => h.name)
    };

    let currentContext = { ...context };
    let cancelled = false;

    // Crear cadena de middleware
    const executeChain = async (index) => {
      // Si llegamos al final de la cadena, retornar contexto
      if (index >= hooks.length) {
        return currentContext;
      }

      const hook = hooks[index];
      const startTime = Date.now();

      try {
        let nextCalled = false;

        // Función next
        const next = async (modifiedContext) => {
          nextCalled = true;

          // Si se pasa un contexto modificado, usarlo
          if (modifiedContext !== undefined) {
            currentContext = { ...currentContext, ...modifiedContext };
          }

          // Continuar con siguiente hook
          return await executeChain(index + 1);
        };

        // Ejecutar middleware
        await hook.middleware(currentContext, next);

        // Si no se llamó next(), la operación fue cancelada
        if (!nextCalled) {
          logger.debug(`[WuHooks] Hook "${hook.name}" cancelled execution`);
          cancelled = true;
          return { cancelled: true };
        }

        const duration = Date.now() - startTime;
        logger.debug(`[WuHooks] Hook "${hook.name}" executed in ${duration}ms`);

      } catch (error) {
        console.error(`[WuHooks] Error in hook "${hook.name}":`, error);

        // Si hay error, pasar al siguiente hook
        return await executeChain(index + 1);
      }

      return currentContext;
    };

    // Ejecutar cadena
    const result = await executeChain(0);

    // Completar log
    executionEntry.duration = Date.now() - executionEntry.timestamp;
    executionEntry.cancelled = cancelled;
    executionEntry.success = !cancelled;

    this.executionLog.push(executionEntry);

    // Mantener límite de log
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog.shift();
    }

    return result;
  }

  /**
   * 🚀 HELPER: Registrar hook para múltiples fases
   * @param {Array<string>} phases - Fases del lifecycle
   * @param {Function} middleware - Función middleware
   * @param {Object} options - Opciones
   * @returns {Function} Función para desregistrar de todas las fases
   */
  useMultiple(phases, middleware, options = {}) {
    const unregisterFns = phases.map(phase =>
      this.use(phase, middleware, { ...options, name: `${options.name}_${phase}` })
    );

    // Retornar función que desregistra de todas las fases
    return () => unregisterFns.forEach(fn => fn());
  }

  /**
   * 📋 GET HOOKS: Obtener hooks registrados
   * @param {string} phase - Fase del lifecycle (opcional)
   * @returns {Object|Array}
   */
  getHooks(phase) {
    if (phase) {
      return this.hooks.get(phase) || [];
    }

    // Retornar todos los hooks
    const allHooks = {};
    this.hooks.forEach((hooks, phase) => {
      allHooks[phase] = hooks.map(h => ({
        name: h.name,
        priority: h.priority,
        registeredAt: h.registeredAt
      }));
    });

    return allHooks;
  }

  /**
   * 📊 GET STATS: Estadísticas de hooks
   * @returns {Object}
   */
  getStats() {
    const totalHooks = Array.from(this.hooks.values())
      .reduce((sum, hooks) => sum + hooks.length, 0);

    const executionsByPhase = {};
    this.executionLog.forEach(entry => {
      executionsByPhase[entry.phase] = (executionsByPhase[entry.phase] || 0) + 1;
    });

    const avgDuration = this.executionLog.length > 0
      ? this.executionLog.reduce((sum, entry) => sum + entry.duration, 0) / this.executionLog.length
      : 0;

    const cancelledCount = this.executionLog.filter(entry => entry.cancelled).length;

    return {
      totalHooks,
      totalExecutions: this.executionLog.length,
      executionsByPhase,
      avgDuration: Math.round(avgDuration),
      cancelledCount,
      recentExecutions: this.executionLog.slice(-10)
    };
  }

  /**
   * 🧹 CLEANUP: Limpiar todos los hooks
   * @param {string} phase - Fase específica (opcional)
   */
  cleanup(phase) {
    if (phase) {
      this.hooks.set(phase, []);
      logger.debug(`[WuHooks] Hooks cleaned for ${phase}`);
    } else {
      this.lifecyclePhases.forEach(p => {
        this.hooks.set(p, []);
      });
      this.executionLog = [];
      logger.debug('[WuHooks] 🧹 All hooks cleaned');
    }
  }
}

/**
 * 🔧 HELPER: Crear middleware hooks fácilmente
 */

/**
 * Crear hook simple que siempre llama next
 * @param {Function} fn - Función a ejecutar
 * @returns {Function} Middleware function
 */
export const createSimpleHook = (fn) => {
  return async (context, next) => {
    await fn(context);
    await next();
  };
};

/**
 * Crear hook condicional
 * @param {Function} condition - Función de condición (context) => boolean
 * @param {Function} fn - Función a ejecutar si condición es true
 * @returns {Function} Middleware function
 */
export const createConditionalHook = (condition, fn) => {
  return async (context, next) => {
    if (await condition(context)) {
      await fn(context);
    }
    await next();
  };
};

/**
 * Crear hook que puede cancelar operación
 * @param {Function} shouldContinue - Función que retorna true para continuar
 * @returns {Function} Middleware function
 */
export const createGuardHook = (shouldContinue) => {
  return async (context, next) => {
    if (await shouldContinue(context)) {
      await next();
    }
    // Si no retorna true, no llama next() y cancela
  };
};

/**
 * Crear hook que modifica contexto
 * @param {Function} transformer - Función que transforma el contexto
 * @returns {Function} Middleware function
 */
export const createTransformHook = (transformer) => {
  return async (context, next) => {
    const modified = await transformer(context);
    await next(modified);
  };
};

/**
 * Crear hook con timeout
 * @param {Function} fn - Función a ejecutar
 * @param {number} timeout - Timeout en ms
 * @returns {Function} Middleware function
 */
export const createTimedHook = (fn, timeout = 5000) => {
  return async (context, next) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Hook timeout')), timeout)
    );

    try {
      await Promise.race([fn(context), timeoutPromise]);
      await next();
    } catch (error) {
      console.error('[WuHooks] Timed hook failed:', error);
      await next(); // Continuar a pesar del error
    }
  };
};
