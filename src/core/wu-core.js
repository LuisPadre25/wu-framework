/**
 * WU-FRAMEWORK: UNIVERSAL MICROFRONTENDS
 * Motor principal agnostico - Funciona con cualquier framework
 */

import { WuLoader } from './wu-loader.js';
import { WuSandbox } from './wu-sandbox.js';
import { WuManifest } from './wu-manifest.js';
import { logger } from './wu-logger.js';
import { default as store } from './wu-store.js';
import { WuApp } from './wu-app.js';
import { WuCache } from './wu-cache.js';
import { WuEventBus } from './wu-event-bus.js';
import { WuPerformance } from './wu-performance.js';
import { WuPluginSystem } from './wu-plugin.js';
import { WuLoadingStrategy } from './wu-strategies.js';
import { WuErrorBoundary } from './wu-error-boundary.js';
import { WuLifecycleHooks } from './wu-hooks.js';
import { WuHtmlParser } from './wu-html-parser.js';
import { WuScriptExecutor } from './wu-script-executor.js';
import { WuIframeSandbox } from './wu-iframe-sandbox.js';
import { WuPrefetch } from './wu-prefetch.js';
import { WuOverrides } from './wu-overrides.js';

export class WuCore {
  constructor(options = {}) {
    // Registros principales
    this.apps = new Map();           // Apps registradas
    this.definitions = new Map();    // Definiciones de lifecycle
    this.manifests = new Map();      // Manifiestos cargados
    this.mounted = new Map();        // Apps montadas
    this.hidden = new Map();         // Keep-alive hidden apps
    this._pendingUnmounts = new Map(); // Deferred unmount timers (StrictMode compat)
    this._mountingPromises = new Map(); // In-flight mount dedup

    // Componentes core
    this.loader = new WuLoader();
    this.sandbox = new WuSandbox();
    this.manifest = new WuManifest();
    this.store = store;

    // Strict sandbox support: HTML entry + script execution in proxy
    this.htmlParser = new WuHtmlParser();
    this.scriptExecutor = new WuScriptExecutor();

    // Sistemas esenciales
    this.cache = new WuCache({ storage: 'localStorage', maxSize: 100 }); // 100MB cache
    this.eventBus = new WuEventBus();
    this.performance = new WuPerformance();

    // Advanced systems
    this.pluginSystem = new WuPluginSystem(this);
    this.strategies = new WuLoadingStrategy(this);
    this.errorBoundary = new WuErrorBoundary(this);
    this.hooks = new WuLifecycleHooks(this);
    this.prefetcher = new WuPrefetch(this);
    this.overrides = new WuOverrides();

    // Estado
    this.isInitialized = false;

    logger.wuInfo('Wu Framework initialized - Universal Microfrontends');
  }

  /**
   * Inicializar wu-framework con configuracion de apps
   * @param {Object} config - Configuracion { apps: [{name, url}, ...] }
   */
  async init(config) {
    if (this.isInitialized) {
      logger.wuWarn('Framework already initialized');
      return;
    }

    // Global sandbox mode: 'module' (default) or 'strict'
    this._sandboxMode = config.sandbox || 'module';

    logger.wuDebug(`Initializing (sandbox: ${this._sandboxMode}) with apps:`, config.apps?.map(app => app.name));

    try {
      // Execute beforeInit hooks
      const beforeInitResult = await this.hooks.execute('beforeInit', { config });
      if (beforeInitResult.cancelled) {
        logger.wuWarn('Initialization cancelled by beforeInit hook');
        return;
      }

      // Call plugin beforeInit hooks
      await this.pluginSystem.callHook('beforeInit', { config });

      // Configure and apply cookie overrides (QA/testing: wu-override:<app>=<url>)
      if (config.overrides) {
        this.overrides.configure(config.overrides);
      }
      const apps = config.apps || [];
      this.overrides.refresh();
      this.overrides.applyToApps(apps);

      // Registrar todas las apps
      for (const appConfig of apps) {
        await this.registerApp(appConfig);
      }

      // Preload apps with eager/preload strategies
      await this.strategies.preload(config.apps || []);

      this.isInitialized = true;

      // Execute afterInit hooks
      await this.hooks.execute('afterInit', { config });

      // Call plugin afterInit hooks
      await this.pluginSystem.callHook('afterInit', { config });

      logger.wuInfo('Framework initialized successfully');
    } catch (error) {
      logger.wuError('Initialization failed:', error);

      // Call plugin error hooks
      await this.pluginSystem.callHook('onError', { phase: 'init', error });

      throw error;
    }
  }

  /**
   * Registrar una aplicacion
   * @param {Object} appConfig - { name, url, keepAlive, sandbox, container, ... }
   */
  async registerApp(appConfig) {
    const { name, url } = appConfig;

    try {
      logger.wuDebug(`Registering app: ${name} from ${url}`);

      // Cargar manifest
      const manifestData = await this.manifest.load(url);
      this.manifests.set(name, manifestData);

      // Registrar la app — preserve all config fields (keepAlive, sandbox, container, etc.)
      this.apps.set(name, {
        ...appConfig,
        manifest: manifestData,
        status: 'registered'
      });

      logger.wuDebug(`App ${name} registered successfully`);
    } catch (error) {
      logger.wuError(`Failed to register app ${name}:`, error);
      throw error;
    }
  }

  /**
   * Definir lifecycle de una micro-app
   * @param {string} appName - Nombre de la app
   * @param {Object} lifecycle - { mount, unmount }
   */
  define(appName, lifecycle) {
    if (!lifecycle.mount) {
      throw new Error(`[Wu] Mount function required for app: ${appName}`);
    }

    this.definitions.set(appName, lifecycle);

    // Dispatch custom event for external listeners
    const event = new CustomEvent('wu:app:ready', {
      detail: { appName, timestamp: Date.now() }
    });
    window.dispatchEvent(event);

    logger.wuDebug(`Lifecycle defined for: ${appName}`);
  }

  /**
   * Mount app with multi-retry mounting and recovery.
   * If the app is in keep-alive (hidden) state, shows it instantly.
   *
   * @param {string} appName - Nombre de la app
   * @param {string} containerSelector - Selector del contenedor
   */
  async mount(appName, containerSelector) {
    // ── StrictMode guard: cancel pending deferred unmount ──
    // React StrictMode cycle: effect(mount) → cleanup(unmount) → effect(mount)
    // The cleanup fires between two mounts. By deferring the actual unmount,
    // the second mount cancels it and the app stays alive — zero flicker.
    if (this._pendingUnmounts.has(appName)) {
      clearTimeout(this._pendingUnmounts.get(appName));
      this._pendingUnmounts.delete(appName);
      logger.wuDebug(`${appName} deferred unmount cancelled by remount`);
    }

    // Already mounted in same container → no-op
    if (this.mounted.has(appName)) {
      const existing = this.mounted.get(appName);
      if (existing.containerSelector === containerSelector) {
        logger.wuDebug(`${appName} already mounted in ${containerSelector}`);
        return;
      }
    }

    // Deduplicate concurrent mounts (StrictMode fires effect twice)
    if (this._mountingPromises.has(appName)) {
      logger.wuDebug(`${appName} mount already in progress, deduplicating`);
      return await this._mountingPromises.get(appName);
    }

    // Check if app is in keep-alive (hidden) state
    const hiddenEntry = this.hidden.get(appName);
    if (hiddenEntry) {
      if (hiddenEntry.containerSelector === containerSelector) {
        // Same container → instant show (no reload)
        return await this.show(appName);
      }
      // Different container → destroy hidden state, remount normally
      await this._destroyHidden(appName);
    }

    // Track mount promise for deduplication
    const mountPromise = this.mountWithRecovery(appName, containerSelector, 0);
    this._mountingPromises.set(appName, mountPromise);

    try {
      return await mountPromise;
    } finally {
      this._mountingPromises.delete(appName);
    }
  }

  /**
   * Mount with recovery: self-healing app mounting
   */
  async mountWithRecovery(appName, containerSelector, attempt = 0) {
    const maxAttempts = 3;

    try {
      // Start performance measurement
      this.performance.startMeasure('mount', appName);

      logger.wuDebug(`Mounting ${appName} in ${containerSelector} (attempt ${attempt + 1})`);

      // Execute beforeLoad hooks
      const beforeLoadResult = await this.hooks.execute('beforeLoad', { appName, containerSelector, attempt });
      if (beforeLoadResult.cancelled) {
        logger.wuWarn('Mount cancelled by beforeLoad hook');
        return;
      }

      // Call plugin beforeMount hooks
      const pluginBeforeMount = await this.pluginSystem.callHook('beforeMount', { appName, containerSelector });
      if (pluginBeforeMount === false) {
        logger.wuWarn('Mount cancelled by plugin beforeMount hook');
        return;
      }

      // Verify app is registered
      const app = this.apps.get(appName);
      if (!app) {
        throw new Error(`App ${appName} not registered. Call wu.init() first.`);
      }

      // Container reality check
      const container = document.querySelector(containerSelector);
      if (!container) {
        throw new Error(`Container not found: ${containerSelector}`);
      }

      // Create sandbox - pasar manifest con styleMode y URL de la app
      const sandbox = this.sandbox.create(appName, container, {
        manifest: app.manifest,
        styleMode: app.manifest?.styleMode,
        appUrl: app.url // Pasar URL de la app para filtrar estilos de apps fully-isolated
      });

      // Execute afterLoad hooks
      await this.hooks.execute('afterLoad', { appName, containerSelector, sandbox });

      // Resolve lifecycle definition
      let lifecycle = this.definitions.get(appName);
      if (!lifecycle) {
        // Load remote app
        await this.loadAndMountRemoteApp(app, sandbox);
        lifecycle = this.definitions.get(appName);

        if (!lifecycle) {
          throw new Error(`App ${appName} did not register with wu.define()`);
        }
      }

      // Execute beforeMount hooks
      const beforeMountResult = await this.hooks.execute('beforeMount', { appName, containerSelector, sandbox, lifecycle });
      if (beforeMountResult.cancelled) {
        logger.wuWarn('Mount cancelled by beforeMount hook');
        return;
      }

      // Wait for styles to be ready before mounting
      if (sandbox.stylesReady) {
        logger.wuDebug(`Waiting for styles to be ready for ${appName}...`);
        await sandbox.stylesReady;
        logger.wuDebug(`Styles ready for ${appName}`);
      }

      // Execute mount lifecycle
      await lifecycle.mount(sandbox.container);

      // Register mounted app
      this.mounted.set(appName, {
        app,
        sandbox,
        lifecycle,
        container: sandbox.container,
        hostContainer: container,
        containerSelector,
        timestamp: Date.now(),
        state: 'stable'
      });

      // End performance measurement
      const mountTime = this.performance.endMeasure('mount', appName);

      // Execute afterMount hooks
      await this.hooks.execute('afterMount', { appName, containerSelector, sandbox, mountTime });

      // Call plugin afterMount hooks
      await this.pluginSystem.callHook('afterMount', { appName, containerSelector, mountTime });

      // Emit mount event
      this.eventBus.emit('app:mounted', { appName, mountTime, attempt }, { appName });

      logger.wuInfo(`${appName} mounted successfully in ${mountTime.toFixed(2)}ms`);

    } catch (error) {
      logger.wuError(`Mount attempt ${attempt + 1} failed for ${appName}:`, error);

      // Use error boundary for intelligent error handling
      const errorResult = await this.errorBoundary.handle(error, {
        appName,
        containerSelector,
        retryCount: attempt,
        container: containerSelector
      });

      // Si el error boundary recupero el error, no necesitamos reintentar
      if (errorResult.recovered) {
        logger.wuDebug('Error recovered by error boundary');
        return;
      }

      // Recovery protocol
      if (attempt < maxAttempts - 1 && errorResult.action === 'retry') {
        logger.wuDebug('Initiating recovery protocol...');

        // Clean app state
        await this.appStateCleanup(appName, containerSelector);

        // Temporal stabilization
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));

        // Recursive mounting with recovery
        return await this.mountWithRecovery(appName, containerSelector, attempt + 1);
      }

      // Call plugin error hooks
      await this.pluginSystem.callHook('onError', { phase: 'mount', error, appName });

      // Final mount failure - error boundary already handled fallback UI
      throw error;
    }
  }

  /**
   * App state cleanup: Enhanced container cleanup with framework protection
   */
  async appStateCleanup(appName, containerSelector) {
    try {
      logger.wuDebug(`Starting app state cleanup for ${appName}...`);

      // Clear hidden (keep-alive) state if present
      if (this.hidden.has(appName)) {
        try {
          await this._destroyHidden(appName);
        } catch (hiddenError) {
          logger.wuWarn('Hidden app cleanup failed:', hiddenError);
        }
      }

      // Clear any existing mounted state safely
      if (this.mounted.has(appName)) {
        try {
          await this.unmount(appName, { force: true });
        } catch (unmountError) {
          logger.wuWarn('Unmount failed during cleanup:', unmountError);
        }
      }

      // Enhanced container cleanup with Vue safety measures
      const container = document.querySelector(containerSelector);
      if (container) {
        // Protect Vue's reactivity system
        if (container.shadowRoot) {
          try {
            // Clear shadow root content safely
            const shadowChildren = Array.from(container.shadowRoot.children);
            shadowChildren.forEach(child => {
              try {
                child.remove();
              } catch (removeError) {
                logger.wuWarn('Failed to remove shadow child:', removeError);
              }
            });
          } catch (shadowError) {
            logger.wuWarn('Shadow root cleanup failed:', shadowError);
          }
        }

        // Clear any direct children if no shadow root
        if (!container.shadowRoot && container.children.length > 0) {
          try {
            container.innerHTML = '';
          } catch (htmlError) {
            logger.wuWarn('Container innerHTML cleanup failed:', htmlError);
          }
        }

        // Reset container attributes
        container.removeAttribute('data-wu-app');
        container.removeAttribute('data-quantum-state');
        container.removeAttribute('wu-debug');
      }

      // Reset definition state
      this.definitions.delete(appName);

      // Clear sandbox registry
      if (this.sandbox && this.sandbox.sandboxes) {
        this.sandbox.sandboxes.delete(appName);
      }

      logger.wuDebug(`App state cleaned successfully for ${appName}`);

    } catch (cleanupError) {
      logger.wuWarn(`App cleanup partial failure for ${appName}:`, cleanupError);

      // Emergency cleanup - force clear everything
      try {
        const container = document.querySelector(containerSelector);
        if (container) {
          container.style.display = 'none';
          setTimeout(() => {
            if (container) {
              container.style.display = '';
            }
          }, 100);
        }
      } catch (emergencyError) {
        logger.wuError('Emergency cleanup failed:', emergencyError);
      }
    }
  }

  /**
   * Remote app loader: Load app in the configured sandbox mode.
   *
   * Three modes:
   *
   * - module (default): ES6 import() + patchWindow for side-effect tracking.
   *   Works with Vite, HMR, ES modules. App code runs in global scope.
   *   Proxy is a cleanup tracker, not an isolation boundary.
   *
   * - strict: Hidden iframe + real import(). True JS isolation.
   *   App code runs in iframe's window (separate global context).
   *   Document operations proxied to Shadow DOM.
   *   Preserves: tree shaking, source maps, HMR.
   *   Falls back to eval mode if import() fails (CORS, etc.)
   *
   * - eval: Fetch HTML → parse scripts → execute with(proxy).
   *   Maximum JS isolation via with(proxy) statement.
   *   Requires bundled apps (UMD/IIFE), not ES modules.
   *   No tree shaking, no source maps, no HMR.
   *
   * Set per-app: { name: 'app', url: '...', sandbox: 'strict' }
   * Or globally: wu.init({ sandbox: 'strict', apps: [...] })
   */
  async loadAndMountRemoteApp(app, sandbox) {
    const mode = app.sandbox || this._sandboxMode || 'module';

    if (mode === 'strict') {
      await this._loadStrict(app, sandbox);
    } else if (mode === 'eval') {
      await this._loadEval(app, sandbox);
    } else {
      await this._loadModule(app, sandbox);
    }
  }

  /**
   * MODULE MODE: import() + patchWindow (default).
   * Side effects tracked during load, cleaned on unmount.
   * App code runs in global scope.
   */
  async _loadModule(app, sandbox) {
    const moduleUrl = await this.resolveModulePath(app);
    logger.wuDebug(`[module] Loading ES module: ${moduleUrl}`);

    const jsSandbox = sandbox.jsSandbox;
    if (jsSandbox?.patchWindow) {
      jsSandbox.patchWindow();
    }

    try {
      await this.moduleLoader(moduleUrl, app.name);
      logger.wuDebug(`[module] ES module loaded: ${app.name}`);
    } catch (error) {
      logger.wuError(`[module] Failed to load ${moduleUrl}:`, error);
      throw error;
    } finally {
      if (jsSandbox?.unpatchWindow) {
        jsSandbox.unpatchWindow();
      }
    }
  }

  /**
   * STRICT MODE: Hidden iframe + real import().
   *
   * The iframe provides a separate window context. import() inside the iframe
   * is a real ES module import — tree shaking, source maps, and HMR all work.
   *
   * Pipeline:
   * 1. Create hidden iframe with <base href="appUrl">
   * 2. Patch iframe's document → DOM operations go to Shadow DOM
   * 3. import() the app module inside iframe
   * 4. Wait for wu.define() registration
   *
   * If import() fails (CORS, network, etc.), falls back to eval mode
   * with a console warning explaining why.
   */
  async _loadStrict(app, sandbox) {
    logger.wuDebug(`[strict] Loading ${app.name} via iframe sandbox`);

    // Create and activate iframe sandbox
    const iframeSandbox = new WuIframeSandbox(app.name);
    iframeSandbox.activate(app.url, sandbox.container, sandbox.shadowRoot);
    sandbox.iframeSandbox = iframeSandbox;

    try {
      // Resolve module path (same logic as module mode)
      const moduleUrl = await this.resolveModulePath(app);
      logger.wuDebug(`[strict] Importing module in iframe: ${moduleUrl}`);

      // Import module inside iframe — real import()!
      await iframeSandbox.importModule(moduleUrl);
      logger.wuDebug(`[strict] Module imported for ${app.name}`);

    } catch (importError) {
      // import() failed — likely CORS or module error.
      // Fall back to eval mode (fetch + parse + with(proxy)).
      logger.wuWarn(
        `[strict] iframe import failed for ${app.name}: ${importError.message}\n` +
        `Falling back to eval mode (fetch + parse + execute with proxy).\n` +
        `To fix: ensure the app's dev server sets Access-Control-Allow-Origin: * headers,\n` +
        `or use sandbox: 'eval' explicitly for UMD/IIFE bundles.`
      );

      // Destroy failed iframe
      iframeSandbox.destroy();
      sandbox.iframeSandbox = null;

      // Fallback to eval mode
      await this._loadEval(app, sandbox);
      return;
    }

    // Wait for wu.define()
    await this._waitForDefine(app.name, 'strict');

    logger.wuDebug(`[strict] ${app.name} loaded and registered via iframe`);
  }

  /**
   * EVAL MODE: Fetch HTML → parse → execute scripts inside proxy.
   *
   * Maximum JS isolation via with(proxy) statement — all unqualified
   * identifiers (setTimeout, document, fetch) go through proxy traps.
   *
   * Requires bundled apps (UMD/IIFE). ES modules cannot be eval'd.
   * No tree shaking, no source maps, no HMR.
   *
   * Pipeline:
   * 1. Fetch HTML from app URL
   * 2. Parse: extract scripts (inline + external), styles, clean DOM
   * 3. Inject DOM + styles into Shadow DOM
   * 4. Execute all scripts inside the proxy via WuScriptExecutor
   * 5. Wait for wu.define()
   */
  async _loadEval(app, sandbox) {
    logger.wuDebug(`[eval] Loading ${app.name} from ${app.url}`);

    const jsSandbox = sandbox.jsSandbox;
    const proxy = jsSandbox.getProxy();

    if (!proxy) {
      throw new Error(`[eval] No active proxy for ${app.name}. Sandbox must be activated first.`);
    }

    // 1. Fetch and parse HTML
    const parsed = await this.htmlParser.fetchAndParse(app.url, app.name);

    // 2. Inject clean DOM into container
    if (parsed.dom) {
      sandbox.container.innerHTML = parsed.dom;
    }

    // 3. Inject styles into shadow root
    const styleTarget = sandbox.shadowRoot || sandbox.container;

    for (const cssText of parsed.styles.inline) {
      const style = document.createElement('style');
      style.textContent = cssText;
      styleTarget.appendChild(style);
    }

    for (const href of parsed.styles.external) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      styleTarget.appendChild(link);
    }

    // 4. Build and execute scripts inside the proxy
    const scripts = [];
    for (const content of parsed.scripts.inline) {
      scripts.push({ content });
    }
    for (const src of parsed.scripts.external) {
      scripts.push({ src });
    }

    await this.scriptExecutor.executeAll(scripts, app.name, proxy);
    logger.wuDebug(`[eval] Scripts executed for ${app.name}`);

    // 5. Wait for wu.define()
    await this._waitForDefine(app.name, 'eval');

    logger.wuDebug(`[eval] ${app.name} loaded and registered`);
  }

  /**
   * Wait for an app to call wu.define() with a timeout.
   * Shared by strict and eval modes.
   */
  async _waitForDefine(appName, mode) {
    const maxWaitTime = 10000;
    const checkInterval = 50;
    const startTime = Date.now();

    while (!this.definitions.has(appName)) {
      if (Date.now() - startTime >= maxWaitTime) {
        throw new Error(
          `[${mode}] App '${appName}' loaded but wu.define() was not called within ${maxWaitTime}ms.\n` +
          `Make sure your app calls: window.wu.define('${appName}', { mount, unmount })`
        );
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * Module path resolver: Intelligent URL construction with fallback
   * Intelligently resolves module paths with real-time validation
   */
  async resolveModulePath(app) {
    let entryFile = app.manifest?.entry || 'main.js';
    const baseUrl = app.url.replace(/\/$/, ''); // Remove trailing slash

    // Normalize path: Remove duplicated directories
    // If entry already starts with 'src/', 'dist/', etc., use it as-is
    const hasFolderPrefix = /^(src|dist|public|build|assets|lib|es)\//.test(entryFile);

    if (hasFolderPrefix) {
      logger.wuDebug(`Entry already has folder prefix: ${entryFile}`);
      // Entry already has folder, just use baseUrl + entryFile
      const directPath = `${baseUrl}/${entryFile}`;
      logger.wuDebug(`Using direct path: ${directPath}`);
      return directPath;
    }

    // Multi-path candidates (in order of preference)
    const pathCandidates = [
      `${baseUrl}/src/${entryFile}`,           // Standard structure
      `${baseUrl}/${entryFile}`,               // Root level
      `${baseUrl}/dist/${entryFile}`,          // Built version
      `${baseUrl}/public/${entryFile}`,        // Public folder
      `${baseUrl}/build/${entryFile}`,         // Build folder
      `${baseUrl}/assets/${entryFile}`,        // Assets folder
      `${baseUrl}/lib/${entryFile}`,           // Library folder
      `${baseUrl}/es/${entryFile}`             // ES modules folder
    ];

    logger.wuDebug(`Attempting path resolution for ${app.name}...`);

    // Smart path discovery: Try each candidate with validation
    for (let i = 0; i < pathCandidates.length; i++) {
      const candidate = pathCandidates[i];

      try {
        logger.wuDebug(`Testing path candidate ${i + 1}/${pathCandidates.length}: ${candidate}`);

        // Path validation with enhanced verification
        const isValid = await this.validatePath(candidate);

        if (isValid) {
          logger.wuDebug(`Path resolved successfully: ${candidate}`);
          return candidate;
        } else {
          logger.wuDebug(`Path candidate ${i + 1} failed validation: ${candidate}`);
        }

      } catch (error) {
        logger.wuDebug(`Path candidate ${i + 1} threw error: ${candidate} - ${error.message}`);
        continue;
      }
    }

    // Fallback: If all candidates fail, use the first one and let the error bubble up
    const fallbackPath = pathCandidates[0];
    logger.wuWarn(`All path candidates failed, using fallback: ${fallbackPath}`);
    return fallbackPath;
  }

  /**
   * Path validator: Smart existence verification with module testing
   * Validates if a path exists and can be loaded as an ES module
   */
  async validatePath(url) {
    try {
      // Enhanced validation: Try actual module import for reliable verification
      logger.wuDebug(`Testing path: ${url}`);

      // First, try a GET request to check if file exists and is accessible
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-cache',
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });

      if (!response.ok) {
        logger.wuDebug(`Path validation failed - HTTP ${response.status}: ${url}`);
        return false;
      }

      // Check content type and file extension
      const contentType = response.headers.get('content-type') || '';
      const isJavaScript =
        contentType.includes('javascript') ||
        contentType.includes('module') ||
        contentType.includes('text/plain') || // Some servers serve JS as plain text
        url.endsWith('.js') ||
        url.endsWith('.mjs');

      if (!isJavaScript) {
        logger.wuDebug(`Path validation failed - Invalid content type '${contentType}': ${url}`);
        return false;
      }

      // Final verification: Check if content looks like a valid module
      const content = await response.text();

      // Detect HTML fallback: Check if server returned HTML instead of JS
      // Only check if content STARTS with HTML markers (trimmed), not if it contains them anywhere
      // This avoids false positives for Angular/React bundles that contain template strings
      const trimmedContent = content.trim().toLowerCase();
      const isHtmlFallback =
        trimmedContent.startsWith('<!doctype') ||
        trimmedContent.startsWith('<html') ||
        trimmedContent.startsWith('<head') ||
        trimmedContent.startsWith('<body') ||
        trimmedContent.startsWith('<!-');

      if (isHtmlFallback) {
        logger.wuDebug(`Path validation failed - Server returned HTML fallback page: ${url}`);
        return false;
      }

      // Check for valid JavaScript module content
      const hasModuleContent =
        content.includes('export') ||
        content.includes('import') ||
        content.includes('wu.define') ||
        content.includes('module.exports') ||
        content.includes('console.log') ||
        (content.includes('function') && content.length > 10);

      if (!hasModuleContent) {
        logger.wuDebug(`Path validation failed - No valid module content: ${url}`);
        logger.wuDebug(`Content preview: ${content.substring(0, 100)}...`);
        return false;
      }

      logger.wuDebug(`Path validation successful: ${url} (${content.length} chars)`);
      return true;

    } catch (error) {
      // Network, timeout, or parsing error means path is invalid
      logger.wuDebug(`Path validation failed for ${url}: ${error.message}`);
      return false;
    }
  }

  /**
   * Module loader: Advanced registration patterns
   * Handles asynchronous registration with timing synchronization
   * Verifica que definitions tenga el lifecycle despues de cargar
   */
  async moduleLoader(moduleUrl, appName) {
    // Check if already registered
    if (this.definitions.has(appName)) {
      logger.wuDebug(`App ${appName} already registered`);
      return;
    }

    logger.wuDebug(`Using event-based registration for ${appName}`);

    // Load module first
    try {
      await import(/* @vite-ignore */ moduleUrl);
    } catch (loadError) {
      logger.wuError(`Failed to import module ${moduleUrl}:`, loadError);
      throw loadError;
    }

    // Wait for wu.define() to be called with real verification
    const maxWaitTime = 10000; // 10 segundos
    const checkInterval = 50; // Verificar cada 50ms
    const startTime = Date.now();

    while (!this.definitions.has(appName)) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= maxWaitTime) {
        throw new Error(
          `App '${appName}' module loaded but wu.define() was not called within ${maxWaitTime}ms.\n\n` +
          `Make sure your module calls:\n` +
          `  wu.define('${appName}', { mount, unmount })\n\n` +
          `Or using window.wu:\n` +
          `  window.wu.define('${appName}', { mount, unmount })`
        );
      }

      // Esperar un poco antes de verificar de nuevo
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    logger.wuDebug(`App ${appName} loaded and registered (verified in definitions)`);
  }

  /**
   * Desmontar una aplicacion.
   *
   * With keepAlive, the app is hidden instead of destroyed.
   * All DOM, JS state, timers, and iframe are preserved.
   * Re-mounting shows the app instantly.
   *
   * keepAlive is resolved from (in priority order):
   * 1. options.keepAlive (per-call override)
   * 2. app config keepAlive (set via wu.app() or registerApp)
   * 3. false (default: destroy)
   *
   * Use options.force = true to destroy even if keepAlive is set.
   *
   * @param {string} appName - Nombre de la app
   * @param {Object} [options] - Unmount options
   * @param {boolean} [options.keepAlive] - Preserve state for instant re-mount
   * @param {boolean} [options.force] - Force destroy even if keepAlive
   */
  async unmount(appName, options = {}) {
    logger.wuDebug(`Unmounting ${appName}`);

    const mounted = this.mounted.get(appName);
    if (!mounted) {
      // Check if it's hidden (keep-alive) — force destroy if requested
      if (options.force && this.hidden.has(appName)) {
        return await this._destroyHidden(appName);
      }
      logger.wuWarn(`App ${appName} not mounted`);
      return;
    }

    // Resolve keepAlive: per-call > per-app config > default false
    const keepAlive = options.force
      ? false
      : (options.keepAlive ?? mounted.app?.keepAlive ?? false);

    if (keepAlive) {
      return await this.hide(appName);
    }

    // Force → immediate unmount (no deferral)
    if (options.force) {
      return await this._executeUnmount(appName, mounted);
    }

    // ── Deferred unmount: 60ms window for React StrictMode ──
    // StrictMode cycle: effect(mount) → cleanup(unmount) → effect(mount)
    // The cleanup fires between two mounts. By deferring the actual unmount,
    // the second mount() call cancels the timer and the app stays alive.
    if (this._pendingUnmounts.has(appName)) {
      clearTimeout(this._pendingUnmounts.get(appName));
    }

    this._pendingUnmounts.set(appName, setTimeout(async () => {
      this._pendingUnmounts.delete(appName);
      // Re-verify: only unmount if the same mount entry is still current
      if (this.mounted.has(appName) && this.mounted.get(appName) === mounted) {
        try {
          await this._executeUnmount(appName, mounted);
        } catch (error) {
          logger.wuError(`Deferred unmount failed for ${appName}:`, error);
        }
      }
    }, 60));
  }

  /**
   * Execute the actual unmount immediately (no deferral).
   * Called by the deferred timer, force unmount, or destroy.
   * @private
   */
  async _executeUnmount(appName, mounted) {
    try {
      // Execute beforeUnmount hooks
      const beforeUnmountResult = await this.hooks.execute('beforeUnmount', { appName, mounted });
      if (beforeUnmountResult.cancelled) {
        logger.wuWarn('Unmount cancelled by beforeUnmount hook');
        return;
      }

      // Call plugin beforeUnmount hooks
      const pluginBeforeUnmount = await this.pluginSystem.callHook('beforeUnmount', { appName });
      if (pluginBeforeUnmount === false) {
        logger.wuWarn('Unmount cancelled by plugin beforeUnmount hook');
        return;
      }

      // Ejecutar unmount del lifecycle si existe
      if (mounted.lifecycle?.unmount) {
        await mounted.lifecycle.unmount(mounted.container);
      }

      // Destroy iframe sandbox if present (strict mode)
      if (mounted.sandbox.iframeSandbox) {
        mounted.sandbox.iframeSandbox.destroy();
        mounted.sandbox.iframeSandbox = null;
      }

      // Limpiar sandbox
      this.sandbox.cleanup(mounted.sandbox);

      // Remover del registro de montadas
      this.mounted.delete(appName);

      // Execute afterUnmount hooks
      await this.hooks.execute('afterUnmount', { appName });

      // Call plugin afterUnmount hooks
      await this.pluginSystem.callHook('afterUnmount', { appName });

      // Emit unmount event
      this.eventBus.emit('app:unmounted', { appName }, { appName });

      logger.wuDebug(`${appName} unmounted successfully`);
    } catch (error) {
      logger.wuError(`Failed to unmount ${appName}:`, error);

      // Call plugin error hooks
      await this.pluginSystem.callHook('onError', { phase: 'unmount', error, appName });

      // Emit error event
      this.eventBus.emit('app:error', { appName, error: error.message }, { appName });
      throw error;
    }
  }

  /**
   * Hide a mounted app (keep-alive).
   *
   * Preserves all state: DOM in Shadow DOM, JS in iframe, timers, listeners.
   * The app's optional `deactivate()` lifecycle hook is called.
   * Re-show with `show()` or `mount()` with the same container.
   *
   * @param {string} appName - App to hide
   */
  async hide(appName) {
    const mounted = this.mounted.get(appName);
    if (!mounted) {
      logger.wuWarn(`Cannot hide ${appName}: not mounted`);
      return;
    }

    logger.wuDebug(`Hiding ${appName} (keep-alive)`);

    // Call optional deactivate lifecycle hook
    if (mounted.lifecycle?.deactivate) {
      try {
        await mounted.lifecycle.deactivate(mounted.container);
      } catch (err) {
        logger.wuWarn(`deactivate() failed for ${appName}:`, err);
      }
    }

    // Execute beforeUnmount hooks (so plugins know)
    await this.hooks.execute('beforeUnmount', { appName, mounted, keepAlive: true });
    await this.pluginSystem.callHook('beforeUnmount', { appName, keepAlive: true });

    // Hide the host container — all Shadow DOM content stays intact
    mounted.hostContainer.style.display = 'none';
    mounted.state = 'hidden';
    mounted.hiddenAt = Date.now();

    // Move from mounted → hidden
    this.hidden.set(appName, mounted);
    this.mounted.delete(appName);

    // Execute afterUnmount hooks
    await this.hooks.execute('afterUnmount', { appName, keepAlive: true });
    await this.pluginSystem.callHook('afterUnmount', { appName, keepAlive: true });

    // Emit event
    this.eventBus.emit('app:hidden', { appName }, { appName });

    logger.wuInfo(`${appName} hidden (keep-alive) — state preserved`);
  }

  /**
   * Show a hidden (keep-alive) app.
   *
   * Restores visibility instantly — no reload, no remount.
   * The app's optional `activate()` lifecycle hook is called.
   *
   * @param {string} appName - App to show
   */
  async show(appName) {
    const hidden = this.hidden.get(appName);
    if (!hidden) {
      logger.wuWarn(`Cannot show ${appName}: not in keep-alive state`);
      return;
    }

    this.performance.startMeasure('show', appName);
    logger.wuDebug(`Showing ${appName} from keep-alive`);

    // Execute beforeMount hooks
    await this.hooks.execute('beforeMount', {
      appName,
      containerSelector: hidden.containerSelector,
      sandbox: hidden.sandbox,
      lifecycle: hidden.lifecycle,
      keepAlive: true
    });
    await this.pluginSystem.callHook('beforeMount', {
      appName,
      containerSelector: hidden.containerSelector,
      keepAlive: true
    });

    // Show the host container
    hidden.hostContainer.style.display = '';
    hidden.state = 'stable';
    delete hidden.hiddenAt;

    // Move from hidden → mounted
    this.mounted.set(appName, hidden);
    this.hidden.delete(appName);

    // Call optional activate lifecycle hook
    if (hidden.lifecycle?.activate) {
      try {
        await hidden.lifecycle.activate(hidden.container);
      } catch (err) {
        logger.wuWarn(`activate() failed for ${appName}:`, err);
      }
    }

    const showTime = this.performance.endMeasure('show', appName);

    // Execute afterMount hooks
    await this.hooks.execute('afterMount', {
      appName,
      containerSelector: hidden.containerSelector,
      sandbox: hidden.sandbox,
      mountTime: showTime,
      keepAlive: true
    });
    await this.pluginSystem.callHook('afterMount', {
      appName,
      containerSelector: hidden.containerSelector,
      mountTime: showTime,
      keepAlive: true
    });

    // Emit event
    this.eventBus.emit('app:shown', { appName, showTime }, { appName });

    logger.wuInfo(`${appName} shown from keep-alive in ${showTime.toFixed(2)}ms`);
  }

  /**
   * Force-destroy a hidden (keep-alive) app.
   * Runs full cleanup: lifecycle unmount, iframe destroy, sandbox cleanup.
   *
   * @param {string} appName
   * @private
   */
  async _destroyHidden(appName) {
    const hidden = this.hidden.get(appName);
    if (!hidden) return;

    logger.wuDebug(`Force-destroying hidden app: ${appName}`);

    // Show first (so unmount sees the container)
    hidden.hostContainer.style.display = '';
    hidden.state = 'stable';

    // Move back to mounted temporarily
    this.mounted.set(appName, hidden);
    this.hidden.delete(appName);

    // Now do a full unmount
    await this.unmount(appName, { force: true });
  }

  /**
   * Check if an app is in keep-alive (hidden) state.
   * @param {string} appName
   * @returns {boolean}
   */
  isHidden(appName) {
    return this.hidden.has(appName);
  }

  /**
   * Cargar componente compartido (para imports/exports)
   * @param {string} componentPath - Ruta del componente (ej: "shared.Button")
   */
  async use(componentPath) {
    const [appName, componentName] = componentPath.split('.');

    if (!appName || !componentName) {
      throw new Error(`Invalid component path: ${componentPath}. Use format "app.component"`);
    }

    const app = this.apps.get(appName);
    if (!app) {
      throw new Error(`App ${appName} not registered`);
    }

    const manifest = this.manifests.get(appName);
    const exportPath = manifest?.wu?.exports?.[componentName];

    if (!exportPath) {
      throw new Error(`Component ${componentName} not exported by ${appName}`);
    }

    // Cargar componente
    return await this.loader.loadComponent(app.url, exportPath);
  }

  /**
   * Obtener informacion de una app
   * @param {string} appName - Nombre de la app
   */
  getAppInfo(appName) {
    return {
      registered: this.apps.get(appName),
      manifest: this.manifests.get(appName),
      mounted: this.mounted.get(appName),
      definition: this.definitions.get(appName)
    };
  }

  /**
   * Obtener estadisticas del framework
   */
  getStats() {
    return {
      registered: this.apps.size,
      defined: this.definitions.size,
      mounted: this.mounted.size,
      hidden: this.hidden.size,
      apps: Array.from(this.apps.keys())
    };
  }

  /**
   * Store methods: Convenience methods for state management
   */

  /**
   * Get value from global store
   * @param {string} path - Dot notation path
   * @returns {*} Value at path
   */
  getState(path) {
    return this.store.get(path);
  }

  /**
   * Set value in global store
   * @param {string} path - Dot notation path
   * @param {*} value - Value to set
   * @returns {number} Sequence number
   */
  setState(path, value) {
    return this.store.set(path, value);
  }

  /**
   * Subscribe to state changes
   * @param {string} pattern - Path or pattern
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onStateChange(pattern, callback) {
    return this.store.on(pattern, callback);
  }

  /**
   * Batch set multiple state values
   * @param {Object} updates - Object with path:value pairs
   * @returns {Array} Sequence numbers
   */
  batchState(updates) {
    return this.store.batch(updates);
  }

  /**
   * Get store metrics
   * @returns {Object} Performance metrics
   */
  getStoreMetrics() {
    return this.store.getMetrics();
  }

  /**
   * Clear all state
   */
  clearState() {
    this.store.clear();
  }

  /**
   * Set a URL override for an app (QA/testing).
   * Sets a cookie so the override persists across page reloads.
   * Only affects the current browser — no one else sees it.
   *
   * @param {string} appName - App to override
   * @param {string} url - Override URL (e.g., 'http://localhost:5173')
   * @param {Object} [options]
   * @param {number} [options.maxAge=86400] - Cookie lifetime in seconds (default: 24h)
   *
   * @example
   * wu.override('cart', 'http://localhost:5173');
   * wu.override('header', 'https://preview-abc123.vercel.app');
   */
  override(appName, url, options) {
    this.overrides.set(appName, url, options);
  }

  /**
   * Remove URL override for an app.
   * @param {string} appName
   */
  removeOverride(appName) {
    this.overrides.remove(appName);
  }

  /**
   * Get all active overrides.
   * @returns {Object} { appName: url, ... }
   */
  getOverrides() {
    return this.overrides.getAll();
  }

  /**
   * Remove all overrides.
   */
  clearOverrides() {
    this.overrides.clearAll();
  }

  /**
   * Prefetch one or more apps before they're needed.
   *
   * Uses Speculation Rules API (Chrome 121+), falls back to
   * <link rel="modulepreload"> or <link rel="prefetch">.
   *
   * @param {string|string[]} appNames - App name(s) to prefetch
   * @param {Object} [options]
   * @param {'immediate'|'hover'|'visible'|'idle'} [options.on='immediate'] - When to trigger
   * @param {string|Element} [options.target] - Element for hover/visible triggers
   * @param {'conservative'|'moderate'|'eager'} [options.eagerness='moderate'] - Speculation eagerness
   * @returns {Promise<void>|Function} Promise or cleanup function
   *
   * @example
   * wu.prefetch('cart');
   * wu.prefetch('cart', { on: 'hover', target: '#cart-link' });
   * wu.prefetch('cart', { on: 'visible', target: '#cart-section' });
   * wu.prefetch(['profile', 'settings'], { on: 'idle' });
   */
  prefetch(appNames, options) {
    return this.prefetcher.prefetch(appNames, options);
  }

  /**
   * Prefetch all registered but not-yet-mounted apps.
   * @param {Object} [options] - Same options as prefetch()
   */
  prefetchAll(options) {
    return this.prefetcher.prefetchAll(options);
  }

  /**
   * Create WuApp instance for declarative usage
   * @param {string} name - App name
   * @param {Object} config - Configuration { url, container, autoInit }
   * @returns {WuApp} WuApp instance
   */
  app(name, config) {
    return new WuApp(name, config, this);
  }

  /**
   * Limpiar todo el framework
   */
  async destroy() {
    logger.wuDebug('Destroying framework...');

    try {
      // Execute beforeDestroy hooks
      await this.hooks.execute('beforeDestroy', {});

      // Call plugin onDestroy hooks
      await this.pluginSystem.callHook('onDestroy', {});

      // Cancel all pending deferred unmounts
      for (const timer of this._pendingUnmounts.values()) {
        clearTimeout(timer);
      }
      this._pendingUnmounts.clear();
      this._mountingPromises.clear();

      // Force-destroy all hidden (keep-alive) apps first
      for (const appName of [...this.hidden.keys()]) {
        await this._destroyHidden(appName);
      }

      // Desmontar todas las apps
      for (const appName of [...this.mounted.keys()]) {
        await this.unmount(appName, { force: true });
      }

      // Limpiar sistemas esenciales
      this.cache.clear();
      this.eventBus.removeAll();
      this.eventBus.clearHistory();
      this.performance.clearMetrics();

      // Limpiar advanced systems
      this.pluginSystem.cleanup();
      this.strategies.cleanup();
      this.errorBoundary.cleanup();
      this.hooks.cleanup();
      this.prefetcher.cleanup();

      // Limpiar registros
      this.apps.clear();
      this.definitions.clear();
      this.manifests.clear();
      this.mounted.clear();
      this.hidden.clear();

      // Limpiar store
      this.store.clear();

      this.isInitialized = false;

      // Execute afterDestroy hooks
      await this.hooks.execute('afterDestroy', {});

      logger.wuDebug('Framework destroyed');
    } catch (error) {
      logger.wuError('Error during destroy:', error);
      throw error;
    }
  }
}
