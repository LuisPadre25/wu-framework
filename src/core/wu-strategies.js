/**
 * 🎯 WU-STRATEGIES: LOADING STRATEGIES
 *
 * Estrategias de carga para optimizar performance:
 * - Lazy: Carga solo cuando se monta
 * - Eager: Precarga en init
 * - Preload: Usa <link rel="prefetch">
 * - Idle: Carga cuando el navegador está idle
 */

import { logger } from './wu-logger.js';

export class WuLoadingStrategy {
  constructor(core) {
    this.core = core;
    this.strategies = new Map();
    this.loadingQueue = [];
    this.isIdle = false;

    this.registerDefaultStrategies();
    this.setupIdleCallback();

    logger.debug('[WuStrategies] 🎯 Loading strategies initialized');
  }

  /**
   * 📋 REGISTER DEFAULT STRATEGIES
   */
  registerDefaultStrategies() {
    // Lazy: Solo carga cuando se necesita (no precarga)
    this.register('lazy', {
      shouldPreload: false,
      load: async (appName, config) => {
        logger.debug(`[Strategy:Lazy] Loading ${appName} on demand (no preload)`);
        // No hace nada, la app se carga cuando se monta
        return;
      }
    });

    // Eager: Carga inmediatamente en init
    this.register('eager', {
      shouldPreload: true,
      priority: 'high',
      load: async (appName, config) => {
        logger.debug(`[Strategy:Eager] Preloading ${appName} immediately`);

        // Cargar el módulo de la app
        const app = this.core.apps.get(appName);
        if (app) {
          const moduleUrl = await this.core.resolveModulePath(app);
          await import(/* @vite-ignore */ moduleUrl);
          logger.debug(`[Strategy:Eager] ✅ ${appName} preloaded`);
        }
      }
    });

    // Preload: Usa resource hints del navegador
    this.register('preload', {
      shouldPreload: true,
      priority: 'medium',
      load: async (appName, config) => {
        logger.debug(`[Strategy:Preload] Using resource hints for ${appName}`);

        // Crear <link rel="prefetch">
        const app = this.core.apps.get(appName);
        if (app) {
          const moduleUrl = await this.core.resolveModulePath(app);

          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = moduleUrl;
          link.as = 'script';
          document.head.appendChild(link);

          logger.debug(`[Strategy:Preload] ✅ Resource hint added for ${appName}`);
        }
      }
    });

    // Speculate: Uses Speculation Rules API (Chrome 121+) with fallbacks
    this.register('speculate', {
      shouldPreload: true,
      priority: 'medium',
      load: async (appName, config) => {
        if (this.core.prefetcher) {
          await this.core.prefetcher.prefetch(appName, {
            eagerness: config.eagerness || 'moderate'
          });
        }
      }
    });

    // Idle: Carga cuando el navegador está idle
    this.register('idle', {
      shouldPreload: false,
      load: async (appName, config) => {
        logger.debug(`[Strategy:Idle] Queueing ${appName} for idle loading`);

        return new Promise((resolve) => {
          this.loadingQueue.push({
            appName,
            config,
            resolve
          });

          // Si ya estamos idle, procesar inmediatamente
          if (this.isIdle) {
            this.processIdleQueue();
          }
        });
      }
    });
  }

  /**
   * 📦 REGISTER: Registrar estrategia personalizada
   * @param {string} name - Nombre de la estrategia
   * @param {Object} strategy - Configuración de la estrategia
   */
  register(name, strategy) {
    if (!strategy.load || typeof strategy.load !== 'function') {
      throw new Error('[WuStrategies] Strategy must have a load function');
    }

    this.strategies.set(name, {
      name,
      shouldPreload: strategy.shouldPreload || false,
      priority: strategy.priority || 'low',
      load: strategy.load
    });

    logger.debug(`[WuStrategies] Strategy "${name}" registered`);
  }

  /**
   * 🚀 LOAD: Cargar app con estrategia
   * @param {string} appName - Nombre de la app
   * @param {Object} config - Configuración con strategy
   * @returns {Promise}
   */
  async load(appName, config) {
    const strategyName = config.strategy || 'lazy';
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      logger.warn(`[WuStrategies] Strategy "${strategyName}" not found, using lazy`);
      return await this.strategies.get('lazy').load(appName, config);
    }

    return await strategy.load(appName, config);
  }

  /**
   * 🎯 PRELOAD: Precargar apps según estrategia
   * @param {Array} apps - Apps a evaluar para precarga
   */
  async preload(apps) {
    const toPreload = apps.filter(app => {
      const strategy = this.strategies.get(app.strategy || 'lazy');
      return strategy.shouldPreload;
    });

    // Ordenar por prioridad
    toPreload.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aPriority = this.strategies.get(a.strategy)?.priority || 'low';
      const bPriority = this.strategies.get(b.strategy)?.priority || 'low';
      return priorityOrder[aPriority] - priorityOrder[bPriority];
    });

    logger.debug(`[WuStrategies] Preloading ${toPreload.length} apps`);

    // Precargar en orden
    for (const app of toPreload) {
      try {
        await this.load(app.name, app);
      } catch (error) {
        console.error(`[WuStrategies] Failed to preload ${app.name}:`, error);
      }
    }
  }

  /**
   * ⏰ SETUP IDLE CALLBACK: Configurar idle loading
   */
  setupIdleCallback() {
    if ('requestIdleCallback' in window) {
      const idleCallback = (deadline) => {
        this.isIdle = true;
        this.processIdleQueue(deadline);

        // Re-schedule
        requestIdleCallback(idleCallback);
      };

      requestIdleCallback(idleCallback);
    } else {
      // Fallback: usar setTimeout
      setTimeout(() => {
        this.isIdle = true;
        this.processIdleQueue();
      }, 2000);
    }
  }

  /**
   * 📋 PROCESS IDLE QUEUE: Procesar cola de carga idle
   * @param {Object} deadline - IdleDeadline object
   */
  async processIdleQueue(deadline) {
    while (this.loadingQueue.length > 0) {
      // Si tenemos deadline y se acabó el tiempo, salir
      if (deadline && deadline.timeRemaining() <= 0) {
        break;
      }

      const item = this.loadingQueue.shift();

      try {
        const app = this.core.apps.get(item.appName);
        if (app) {
          const moduleUrl = await this.core.resolveModulePath(app);
          await import(/* @vite-ignore */ moduleUrl);
          logger.debug(`[Strategy:Idle] ✅ ${item.appName} loaded during idle time`);
          item.resolve(true);
        } else {
          item.resolve(null);
        }
      } catch (error) {
        console.error(`[Strategy:Idle] Failed to load ${item.appName}:`, error);
        item.resolve(null);
      }
    }
  }

  /**
   * 📊 GET STATS: Estadísticas de estrategias
   * @returns {Object}
   */
  getStats() {
    return {
      totalStrategies: this.strategies.size,
      strategies: Array.from(this.strategies.keys()),
      idleQueueSize: this.loadingQueue.length,
      isIdle: this.isIdle
    };
  }

  /**
   * 🧹 CLEANUP: Limpiar estrategias
   */
  cleanup() {
    this.loadingQueue = [];
    logger.debug('[WuStrategies] 🧹 Strategies cleaned up');
  }
}
