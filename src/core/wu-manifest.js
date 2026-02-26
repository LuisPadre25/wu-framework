/**
 * 📋 WU-MANIFEST: SECURE MANIFEST SYSTEM
 * Validación estricta de wu.json para seguridad
 */

import { logger } from './wu-logger.js';

export class WuManifest {
  constructor() {
    this.cache = new Map();
    this.schemas = new Map();

    // 🔐 Configuración de seguridad
    this.security = {
      maxManifestSize: 100 * 1024, // 100KB máximo
      maxNameLength: 50,
      maxEntryLength: 200,
      maxExports: 100,
      maxImports: 50,
      maxRoutes: 100,
      // Patrones peligrosos en paths
      dangerousPatterns: [
        /\.\./,           // Path traversal
        /^\/etc\//,       // System paths
        /^\/proc\//,
        /^file:\/\//,     // File protocol
        /javascript:/i,   // JS injection
        /data:/i,         // Data URLs
        /<script/i,       // Script tags
        /on\w+\s*=/i      // Event handlers
      ],
      // Dominios bloqueados
      blockedDomains: [
        'evil.com',
        'malware.com'
      ]
    };

    this.defineSchema();
  }

  /**
   * Definir schema de validación para wu.json
   */
  defineSchema() {
    this.schemas.set('wu.json', {
      required: ['name', 'entry'],
      optional: ['wu'],
      wu: {
        optional: ['exports', 'imports', 'routes', 'permissions'],
        exports: 'object',
        imports: 'array',
        routes: 'array',
        permissions: 'array'
      }
    });
  }

  /**
   * Cargar manifest desde URL
   * @param {string} appUrl - URL base de la aplicación
   * @returns {Object} Manifest parseado y validado
   */
  async load(appUrl) {
    const manifestUrl = `${appUrl}/wu.json`;

    logger.debug(`[WuManifest] 📥 Loading manifest: ${manifestUrl}`);

    try {
      // Verificar cache
      if (this.cache.has(manifestUrl)) {
        logger.debug(`[WuManifest] ⚡ Cache hit: ${manifestUrl}`);
        return this.cache.get(manifestUrl);
      }

      // Cargar manifest
      const response = await fetch(manifestUrl, {
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        // Si no hay manifest, crear uno básico
        if (response.status === 404) {
          logger.debug(`[WuManifest] 📄 No manifest found, creating default for: ${appUrl}`);
          return this.createDefaultManifest(appUrl);
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const manifestText = await response.text();

      // 🔐 Validar tamaño del manifest
      if (manifestText.length > this.security.maxManifestSize) {
        throw new Error(`Manifest too large (${manifestText.length} bytes, max ${this.security.maxManifestSize})`);
      }

      // 🔐 Intentar parsear JSON de forma segura
      let manifest;
      try {
        manifest = JSON.parse(manifestText);
      } catch (parseError) {
        throw new Error(`Invalid JSON in manifest: ${parseError.message}`);
      }

      // Validar manifest
      const validatedManifest = this.validate(manifest);

      // Cachear resultado
      this.cache.set(manifestUrl, validatedManifest);

      logger.debug(`[WuManifest] ✅ Manifest loaded: ${manifest.name}`);
      return validatedManifest;

    } catch (error) {
      console.error(`[WuManifest] ❌ Failed to load manifest: ${manifestUrl}`, error);

      // En caso de error, intentar crear manifest por defecto
      try {
        return this.createDefaultManifest(appUrl);
      } catch (defaultError) {
        throw new Error(`Failed to load manifest from ${manifestUrl}: ${error.message}`);
      }
    }
  }

  /**
   * Crear manifest por defecto cuando no existe wu.json
   * @param {string} appUrl - URL de la aplicación
   * @returns {Object} Manifest por defecto
   */
  createDefaultManifest(appUrl) {
    // Extraer nombre de la app de la URL
    const appName = this.extractAppNameFromUrl(appUrl);

    const defaultManifest = {
      name: appName,
      entry: 'index.js',
      wu: {
        exports: {},
        imports: [],
        routes: [],
        permissions: []
      }
    };

    logger.debug(`[WuManifest] 🔧 Created default manifest for: ${appName}`);
    return defaultManifest;
  }

  /**
   * Extraer nombre de app desde URL
   * @param {string} url - URL de la aplicación
   * @returns {string} Nombre de la aplicación
   */
  extractAppNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);

      // Usar el último segmento como nombre de la app
      return pathSegments[pathSegments.length - 1] || 'unknown-app';
    } catch {
      // Si no es una URL válida, usar como está
      return url.replace(/[^a-zA-Z0-9-]/g, '') || 'unknown-app';
    }
  }

  /**
   * 🔐 SANITIZE STRING: Limpiar string de caracteres peligrosos
   */
  _sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[<>'"]/g, '') // Remove HTML chars
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control chars
      .trim();
  }

  /**
   * 🔐 CHECK DANGEROUS PATTERNS: Verificar patrones peligrosos
   */
  _hasDangerousPatterns(str) {
    if (typeof str !== 'string') return false;
    return this.security.dangerousPatterns.some(pattern => pattern.test(str));
  }

  /**
   * 🔐 VALIDATE URL: Verificar que URL es segura
   */
  _isUrlSafe(url) {
    if (typeof url !== 'string') return false;

    // Verificar patrones peligrosos
    if (this._hasDangerousPatterns(url)) {
      return false;
    }

    // Verificar dominios bloqueados
    try {
      const urlObj = new URL(url, 'http://localhost');
      if (this.security.blockedDomains.some(d => urlObj.hostname.includes(d))) {
        return false;
      }
    } catch {
      // Si no es URL válida, verificar como path
      if (this._hasDangerousPatterns(url)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validar manifest contra schema con validación de seguridad
   * @param {Object} manifest - Manifest a validar
   * @returns {Object} Manifest validado
   */
  validate(manifest) {
    const schema = this.schemas.get('wu.json');

    // 🔐 Verificar que manifest es un objeto
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Manifest must be a valid object');
    }

    // Verificar campos requeridos
    for (const field of schema.required) {
      if (!manifest[field]) {
        throw new Error(`Required field missing: ${field}`);
      }
    }

    // 🔐 Validar nombre
    if (typeof manifest.name !== 'string') {
      throw new Error('name must be a string');
    }
    if (manifest.name.length > this.security.maxNameLength) {
      throw new Error(`name too long (max ${this.security.maxNameLength} chars)`);
    }
    if (this._hasDangerousPatterns(manifest.name)) {
      throw new Error('name contains dangerous patterns');
    }

    // 🔐 Validar entry
    if (typeof manifest.entry !== 'string') {
      throw new Error('entry must be a string');
    }
    if (manifest.entry.length > this.security.maxEntryLength) {
      throw new Error(`entry too long (max ${this.security.maxEntryLength} chars)`);
    }
    if (!this._isUrlSafe(manifest.entry)) {
      throw new Error('entry contains dangerous patterns');
    }

    // Verificar tipos en sección wu
    if (manifest.wu) {
      const wu = manifest.wu;

      if (wu.exports && typeof wu.exports !== 'object') {
        throw new Error('wu.exports must be an object');
      }

      // 🔐 Validar límites de exports
      if (wu.exports && Object.keys(wu.exports).length > this.security.maxExports) {
        throw new Error(`Too many exports (max ${this.security.maxExports})`);
      }

      // 🔐 Validar cada export path
      if (wu.exports) {
        for (const [key, path] of Object.entries(wu.exports)) {
          if (!this._isUrlSafe(path)) {
            throw new Error(`Dangerous export path: ${key}`);
          }
        }
      }

      if (wu.imports && !Array.isArray(wu.imports)) {
        throw new Error('wu.imports must be an array');
      }

      // 🔐 Validar límites de imports
      if (wu.imports && wu.imports.length > this.security.maxImports) {
        throw new Error(`Too many imports (max ${this.security.maxImports})`);
      }

      if (wu.routes && !Array.isArray(wu.routes)) {
        throw new Error('wu.routes must be an array');
      }

      // 🔐 Validar límites de routes
      if (wu.routes && wu.routes.length > this.security.maxRoutes) {
        throw new Error(`Too many routes (max ${this.security.maxRoutes})`);
      }

      if (wu.permissions && !Array.isArray(wu.permissions)) {
        throw new Error('wu.permissions must be an array');
      }
    }

    // Validate optional fields
    if (manifest.styleMode !== undefined) {
      const validModes = ['shared', 'isolated', 'fully-isolated'];
      if (!validModes.includes(manifest.styleMode)) {
        logger.warn(`[WuManifest] Invalid styleMode "${manifest.styleMode}", defaulting to "shared". Valid: ${validModes.join(', ')}`);
        manifest.styleMode = 'shared';
      }
    }

    if (manifest.version !== undefined && typeof manifest.version !== 'string') {
      logger.warn('[WuManifest] version must be a string, ignoring');
      delete manifest.version;
    }

    if (manifest.folder !== undefined) {
      if (typeof manifest.folder !== 'string') {
        logger.warn('[WuManifest] folder must be a string, ignoring');
        delete manifest.folder;
      } else if (this._hasDangerousPatterns(manifest.folder)) {
        throw new Error('folder contains dangerous patterns');
      }
    }

    // Normalizar y limpiar manifest
    return this.normalize(manifest);
  }

  /**
   * Normalizar manifest
   * @param {Object} manifest - Manifest a normalizar
   * @returns {Object} Manifest normalizado
   */
  normalize(manifest) {
    const normalized = {
      name: manifest.name.trim(),
      entry: this.normalizeEntry(manifest.entry),
      wu: {
        exports: manifest.wu?.exports || {},
        imports: manifest.wu?.imports || [],
        routes: manifest.wu?.routes || [],
        permissions: manifest.wu?.permissions || []
      }
    };

    // Preservar campos opcionales del manifest (styleMode, version, folder, etc.)
    if (manifest.styleMode) {
      normalized.styleMode = manifest.styleMode;
    }
    if (manifest.version) {
      normalized.version = manifest.version;
    }
    if (manifest.folder) {
      normalized.folder = manifest.folder;
    }

    // Normalizar exports
    if (normalized.wu.exports) {
      const normalizedExports = {};
      for (const [key, path] of Object.entries(normalized.wu.exports)) {
        normalizedExports[key] = this.normalizeComponentPath(path);
      }
      normalized.wu.exports = normalizedExports;
    }

    // Validar imports
    normalized.wu.imports = normalized.wu.imports.filter(imp => {
      if (typeof imp !== 'string' || !imp.includes('.')) {
        logger.warn(`[WuManifest] Invalid import format: ${imp}`);
        return false;
      }
      return true;
    });

    return normalized;
  }

  /**
   * Normalizar entry path
   * @param {string} entry - Entry path
   * @returns {string} Entry normalizado
   */
  normalizeEntry(entry) {
    if (!entry) return 'index.js';

    let normalized = entry.trim();

    // Remover ./ inicial si está presente
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    // Agregar extensión si no la tiene
    if (!normalized.includes('.')) {
      normalized += '.js';
    }

    return normalized;
  }

  /**
   * Normalizar path de componente
   * @param {string} path - Path del componente
   * @returns {string} Path normalizado
   */
  normalizeComponentPath(path) {
    if (!path) return '';

    let normalized = path.trim();

    // Remover ./ inicial si está presente
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    // Agregar extensión si no la tiene
    if (!normalized.includes('.')) {
      normalized += '.js';
    }

    return normalized;
  }

  /**
   * Validar dependencias de imports
   * @param {Array} imports - Lista de imports
   * @param {Map} availableApps - Apps disponibles
   * @returns {Object} Resultado de validación
   */
  validateDependencies(imports, availableApps) {
    const result = {
      valid: [],
      invalid: [],
      missing: []
    };

    for (const importPath of imports) {
      const [appName, componentName] = importPath.split('.');

      if (!appName || !componentName) {
        result.invalid.push({
          import: importPath,
          reason: 'Invalid format. Use "app.component"'
        });
        continue;
      }

      const app = availableApps.get(appName);
      if (!app) {
        result.missing.push({
          import: importPath,
          app: appName,
          reason: 'App not registered'
        });
        continue;
      }

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

    return result;
  }

  /**
   * Crear manifest programáticamente
   * @param {string} name - Nombre de la app
   * @param {Object} config - Configuración
   * @returns {Object} Manifest creado
   */
  create(name, config = {}) {
    const manifest = {
      name: name,
      entry: config.entry || 'index.js',
      wu: {
        exports: config.exports || {},
        imports: config.imports || [],
        routes: config.routes || [],
        permissions: config.permissions || []
      }
    };

    return this.normalize(manifest);
  }

  /**
   * Limpiar cache de manifests
   * @param {string} pattern - Patrón opcional para limpiar URLs específicas
   */
  clearCache(pattern) {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const [url] of this.cache) {
        if (regex.test(url)) {
          this.cache.delete(url);
          logger.debug(`[WuManifest] 🗑️ Cleared cache for: ${url}`);
        }
      }
    } else {
      this.cache.clear();
      logger.debug(`[WuManifest] 🗑️ Manifest cache cleared completely`);
    }
  }

  /**
   * Obtener estadísticas del sistema de manifests
   */
  getStats() {
    return {
      cached: this.cache.size,
      schemas: this.schemas.size,
      cacheKeys: Array.from(this.cache.keys())
    };
  }
}