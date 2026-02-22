/**
 * 💾 WU-CACHE: SECURE INTERNAL CACHING
 *
 * Sistema de caché INTERNO con rate limiting
 * - Rate limiting para prevenir abuso
 * - Cache persistente y en memoria
 * - TTL y LRU eviction
 *
 * ⚠️ USO INTERNO: No exponer en API pública
 */

import { logger } from './wu-logger.js';

export class WuCache {
  constructor(options = {}) {
    this.config = {
      maxSize: options.maxSize || 50, // MB
      maxItems: options.maxItems || 100,
      defaultTTL: options.defaultTTL || 3600000, // 1 hour
      persistent: options.persistent !== false,
      storage: options.storage || 'memory'
    };

    // 🔐 Rate limiting configuration
    this.rateLimiting = {
      enabled: options.rateLimiting !== false,
      maxOpsPerSecond: options.maxOpsPerSecond || 100,
      windowMs: 1000, // 1 second window
      cooldownMs: options.cooldownMs || 5000, // 5 second cooldown after limit
      operations: [],
      inCooldown: false,
      cooldownUntil: 0
    };

    // Memory cache
    this.memoryCache = new Map();

    // LRU tracking
    this.accessOrder = new Map();

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      size: 0,
      rateLimited: 0 // 🔐 Contador de operaciones rechazadas
    };
  }

  /**
   * 🔐 CHECK RATE LIMIT: Verificar si la operación está permitida
   * @returns {boolean} true si la operación está permitida
   */
  _checkRateLimit() {
    if (!this.rateLimiting.enabled) return true;

    const now = Date.now();

    // Verificar si estamos en cooldown
    if (this.rateLimiting.inCooldown) {
      if (now < this.rateLimiting.cooldownUntil) {
        this.stats.rateLimited++;
        return false;
      }
      // Cooldown terminado
      this.rateLimiting.inCooldown = false;
      this.rateLimiting.operations = [];
    }

    // Limpiar operaciones antiguas (fuera de la ventana)
    const windowStart = now - this.rateLimiting.windowMs;
    this.rateLimiting.operations = this.rateLimiting.operations.filter(
      ts => ts > windowStart
    );

    // Verificar límite
    if (this.rateLimiting.operations.length >= this.rateLimiting.maxOpsPerSecond) {
      // Activar cooldown
      this.rateLimiting.inCooldown = true;
      this.rateLimiting.cooldownUntil = now + this.rateLimiting.cooldownMs;
      this.stats.rateLimited++;
      logger.warn(`[WuCache] 🚫 Rate limit exceeded. Cooldown for ${this.rateLimiting.cooldownMs}ms`);
      return false;
    }

    // Registrar operación
    this.rateLimiting.operations.push(now);
    return true;
  }

  /**
   * 🔐 GET RATE LIMIT STATUS
   */
  getRateLimitStatus() {
    const now = Date.now();
    return {
      enabled: this.rateLimiting.enabled,
      inCooldown: this.rateLimiting.inCooldown,
      cooldownRemaining: this.rateLimiting.inCooldown
        ? Math.max(0, this.rateLimiting.cooldownUntil - now)
        : 0,
      currentOps: this.rateLimiting.operations.length,
      maxOps: this.rateLimiting.maxOpsPerSecond,
      rateLimited: this.stats.rateLimited
    };
  }

  /**
   * 🔍 GET: Obtener valor del cache
   * @param {string} key - Clave
   * @returns {*} Valor cacheado o null
   */
  get(key) {
    // 🔐 Check rate limit
    if (!this._checkRateLimit()) {
      return null; // Silently fail on rate limit
    }

    // 1. Buscar en memoria
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key);

      // Verificar TTL
      if (this.isExpired(entry)) {
        this.delete(key);
        this.stats.misses++;
        return null;
      }

      // Actualizar acceso (LRU)
      this.accessOrder.set(key, Date.now());
      this.stats.hits++;

      return entry.value;
    }

    // 2. Buscar en storage persistente
    if (this.config.persistent) {
      const stored = this.getFromStorage(key);
      if (stored) {
        // Restaurar a memoria
        this.memoryCache.set(key, stored);
        this.accessOrder.set(key, Date.now());
        this.stats.hits++;
        return stored.value;
      }
    }

    this.stats.misses++;
    return null;
  }

  /**
   * 💾 SET: Guardar valor en cache
   * @param {string} key - Clave
   * @param {*} value - Valor
   * @param {number} ttl - Time to live (ms)
   * @returns {boolean}
   */
  set(key, value, ttl) {
    // 🔐 Check rate limit
    if (!this._checkRateLimit()) {
      return false; // Reject on rate limit
    }

    try {
      const entry = {
        key,
        value,
        timestamp: Date.now(),
        ttl: ttl || this.config.defaultTTL,
        size: this.estimateSize(value)
      };

      // Verificar si necesitamos hacer espacio
      const hasSpace = this.ensureSpace(entry.size);
      if (hasSpace === false) {
        logger.warn(`[WuCache] ⚠️ Cannot cache item: ${key} (too large)`);
        return false;
      }

      // Guardar en memoria
      this.memoryCache.set(key, entry);
      this.accessOrder.set(key, Date.now());

      // Guardar en storage persistente
      if (this.config.persistent) {
        this.saveToStorage(key, entry);
      }

      this.stats.sets++;
      this.stats.size += entry.size;

      return true;
    } catch (error) {
      logger.warn('[WuCache] ⚠️ Failed to set cache:', error);
      return false;
    }
  }

  /**
   * 🗑️ DELETE: Eliminar del cache
   * @param {string} key - Clave
   */
  delete(key) {
    const entry = this.memoryCache.get(key);
    if (entry) {
      this.stats.size -= entry.size;
    }

    this.memoryCache.delete(key);
    this.accessOrder.delete(key);

    if (this.config.persistent) {
      this.deleteFromStorage(key);
    }
  }

  /**
   * 🧹 CLEAR: Limpiar todo el cache
   */
  clear() {
    this.memoryCache.clear();
    this.accessOrder.clear();
    this.stats.size = 0;

    if (this.config.persistent) {
      this.clearStorage();
    }

    logger.debug('[WuCache] 🧹 Cache cleared');
  }

  /**
   * ⏰ IS EXPIRED: Verificar si entrada expiró
   * @param {Object} entry - Entrada del cache
   * @returns {boolean}
   */
  isExpired(entry) {
    if (!entry.ttl) return false;
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * 📏 ESTIMATE SIZE: Estimar tamaño de un valor
   * @param {*} value - Valor
   * @returns {number} Tamaño en bytes
   */
  estimateSize(value) {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1000; // Estimación por defecto
      }
    }

    return 100; // Tamaño por defecto para primitivos
  }

  /**
   * 🎯 ENSURE SPACE: Asegurar espacio en cache (LRU eviction)
   * @param {number} neededSize - Tamaño necesario
   */
  ensureSpace(neededSize) {
    const maxSizeBytes = this.config.maxSize * 1024 * 1024;

    // 🛡️ FIX: Validar que el item no sea más grande que el máximo permitido
    if (neededSize > maxSizeBytes) {
      logger.warn(`[WuCache] ⚠️ Item size (${neededSize}) exceeds max cache size (${maxSizeBytes}). Skipping.`);
      return false;
    }

    // 🛡️ FIX: Límite de iteraciones para evitar loop infinito
    const maxIterations = this.config.maxItems + 10;
    let iterations = 0;

    // Verificar si necesitamos limpiar
    while ((this.stats.size + neededSize > maxSizeBytes ||
           this.memoryCache.size >= this.config.maxItems) &&
           iterations < maxIterations) {

      iterations++;

      // 🛡️ FIX: Si el cache está vacío pero aún no hay espacio, salir
      if (this.memoryCache.size === 0) {
        logger.warn('[WuCache] ⚠️ Cache empty but still no space. Breaking loop.');
        break;
      }

      // Encontrar entrada menos recientemente usada (LRU)
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [key, time] of this.accessOrder) {
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        logger.debug(`[WuCache] 🗑️ Evicting LRU entry: ${oldestKey}`);
        this.delete(oldestKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }

    // 🛡️ FIX: Log si alcanzamos el límite de iteraciones
    if (iterations >= maxIterations) {
      console.error(`[WuCache] 🚨 Max eviction iterations reached (${maxIterations}). Possible infinite loop prevented.`);
    }

    return true;
  }

  /**
   * 💽 GET FROM STORAGE: Obtener del storage persistente
   * @param {string} key - Clave
   * @returns {Object|null}
   */
  getFromStorage(key) {
    try {
      const storage = this.getStorage();
      const stored = storage.getItem(`wu_cache_${key}`);

      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      logger.warn('[WuCache] ⚠️ Failed to get from storage:', error);
    }
    return null;
  }

  /**
   * 💾 SAVE TO STORAGE: Guardar en storage persistente
   * @param {string} key - Clave
   * @param {Object} entry - Entrada
   */
  saveToStorage(key, entry) {
    const storage = this.getStorage();
    try {
      storage.setItem(`wu_cache_${key}`, JSON.stringify(entry));
    } catch (error) {
      // Storage lleno, limpiar entradas antiguas
      logger.warn('[WuCache] ⚠️ Storage full, cleaning old entries');
      this.cleanOldStorageEntries();

      try {
        storage.setItem(`wu_cache_${key}`, JSON.stringify(entry));
      } catch {
        logger.warn('[WuCache] ⚠️ Failed to save to storage after cleanup');
      }
    }
  }

  /**
   * 🗑️ DELETE FROM STORAGE: Eliminar del storage
   * @param {string} key - Clave
   */
  deleteFromStorage(key) {
    try {
      const storage = this.getStorage();
      storage.removeItem(`wu_cache_${key}`);
    } catch (error) {
      logger.warn('[WuCache] ⚠️ Failed to delete from storage:', error);
    }
  }

  /**
   * 🧹 CLEAR STORAGE: Limpiar storage
   */
  clearStorage() {
    try {
      const storage = this.getStorage();
      const keys = Object.keys(storage);

      keys.forEach(key => {
        if (key.startsWith('wu_cache_')) {
          storage.removeItem(key);
        }
      });
    } catch (error) {
      logger.warn('[WuCache] ⚠️ Failed to clear storage:', error);
    }
  }

  /**
   * 🧹 CLEAN OLD STORAGE ENTRIES: Limpiar entradas antiguas del storage
   */
  cleanOldStorageEntries() {
    try {
      const storage = this.getStorage();
      const keys = Object.keys(storage);
      const entries = [];

      // Recopilar todas las entradas con timestamp
      keys.forEach(key => {
        if (key.startsWith('wu_cache_')) {
          try {
            const entry = JSON.parse(storage.getItem(key));
            entries.push({ key, timestamp: entry.timestamp });
          } catch {}
        }
      });

      // Ordenar por timestamp (más antiguas primero)
      entries.sort((a, b) => a.timestamp - b.timestamp);

      // Eliminar 25% de entradas más antiguas
      const toRemove = Math.ceil(entries.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        storage.removeItem(entries[i].key);
      }

      logger.debug(`[WuCache] 🧹 Cleaned ${toRemove} old storage entries`);
    } catch (error) {
      logger.warn('[WuCache] ⚠️ Failed to clean old storage entries:', error);
    }
  }

  /**
   * 💽 GET STORAGE: Obtener instancia de storage
   * @returns {Storage}
   */
  getStorage() {
    if (this.config.storage === 'localStorage') {
      return window.localStorage;
    } else if (this.config.storage === 'sessionStorage') {
      return window.sessionStorage;
    }
    // Fallback a memoria
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    };
  }

  /**
   * 📊 GET STATS: Obtener estadísticas del cache
   * @returns {Object}
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      items: this.memoryCache.size,
      sizeMB: (this.stats.size / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * ⚙️ CONFIGURE: Actualizar configuración
   * @param {Object} config - Nueva configuración
   */
  configure(config) {
    this.config = {
      ...this.config,
      ...config
    };
  }
}
