/**
 * 🛡️ WU-SANDBOX: ADVANCED ISOLATION SYSTEM
 * Shadow DOM + Proxy Sandbox + Script Execution + HTML Parsing
 * Combina lo mejor de video-code con Shadow DOM nativo
 */

import { WuStyleBridge } from './wu-style-bridge.js';
import { WuProxySandbox } from './wu-proxy-sandbox.js';
import { WuSnapshotSandbox } from './wu-snapshot-sandbox.js';
import { logger } from './wu-logger.js';

export class WuSandbox {
  constructor() {
    // Registros existentes
    this.sandboxes = new Map();
    this.styleBridge = new WuStyleBridge();

    // 🚀 NUEVOS SISTEMAS INTEGRADOS
    this.jsSandboxes = new Map(); // ProxySandbox o SnapshotSandbox por app
    this.sandboxStrategy = this.detectSandboxStrategy();

    logger.wuDebug(`Advanced isolation system initialized (strategy: ${this.sandboxStrategy})`);
  }

  /**
   * Detectar estrategia de sandbox óptima
   * @returns {'proxy' | 'snapshot'} Estrategia a usar
   */
  detectSandboxStrategy() {
    // Verificar si Proxy está disponible
    if (typeof Proxy !== 'undefined') {
      try {
        // Test básico de Proxy
        const testProxy = new Proxy({}, {
          get(target, prop) { return target[prop]; }
        });
        testProxy.test = 'value';

        logger.wuDebug('Proxy available - using ProxySandbox strategy');
        return 'proxy';
      } catch (error) {
        logger.wuWarn('Proxy not working - falling back to SnapshotSandbox');
        return 'snapshot';
      }
    }

    logger.wuWarn('Proxy not available - using SnapshotSandbox strategy');
    return 'snapshot';
  }

  /**
   * 🔧 SMART SANDBOX: Advanced Shadow DOM creation with error recovery
   * @param {string} appName - Nombre de la aplicación
   * @param {HTMLElement} hostContainer - Contenedor host
   * @param {Object} options - Opciones adicionales (styleMode, manifest, etc.)
   * @returns {Object} Sandbox con shadow root y container
   */
  create(appName, hostContainer, options = {}) {
    logger.wuDebug(`Creating sandbox for: ${appName}`);

    try {
      // 🔧 SHADOW DOM VERIFICATION
      if (!hostContainer.attachShadow) {
        throw new Error('Shadow DOM not supported in this browser');
      }

      // 🛠️ SMART CLEANUP: Handle existing shadow roots
      let shadowRoot;
      if (hostContainer.shadowRoot) {
        logger.wuDebug(`Existing shadow root detected for ${appName}, performing cleanup...`);

        // Clear existing shadow root content
        hostContainer.shadowRoot.innerHTML = '';
        shadowRoot = hostContainer.shadowRoot;

        logger.wuDebug(`Existing shadow root cleaned and reused for ${appName}`);
      } else {
        // Create new Shadow DOM
        shadowRoot = hostContainer.attachShadow({
          mode: 'open',
          delegatesFocus: true
        });

        logger.wuDebug(`New shadow root created for ${appName}`);
      }

      // 🎯 Create app container with advanced features
      const appContainer = document.createElement('div');
      appContainer.id = `wu-app-${appName}`;
      appContainer.className = 'wu-app-root';
      appContainer.setAttribute('data-wu-enhanced', 'true');
      appContainer.setAttribute('data-wu-timestamp', Date.now().toString());

      // 🎨 Enhanced base styles with advanced properties
      const baseStyles = document.createElement('style');
      baseStyles.textContent = this.generateSandboxStyles(appName);

      // 🌟 Assemble enhanced Shadow DOM
      shadowRoot.appendChild(baseStyles);
      shadowRoot.appendChild(appContainer);

      // Create JS Sandbox with container reference for DOM/storage scoping
      const jsSandbox = this.createAdvancedJSSandbox(appName);
      if (jsSandbox.setContainer) {
        jsSandbox.setContainer(appContainer, shadowRoot);
      }
      const jsProxy = jsSandbox.activate();

      // Verificar styleMode del manifest antes de inyectar estilos
      const styleMode = options.styleMode || options.manifest?.styleMode;

      const sandbox = {
        appName,
        shadowRoot,
        container: appContainer,
        hostContainer,
        jsSandbox, // NUEVO: ProxySandbox o SnapshotSandbox
        jsProxy, // NUEVO: Proxy para ejecutar scripts
        styles: baseStyles,
        styleMode, // Guardar styleMode para uso futuro
        manifest: options.manifest, // Guardar manifest completo
        created: Date.now(),
        sandbox_state: 'stable',
        recovery_count: 0
      };

      // 🎨 INJECT STYLES: Comportamiento según styleMode
      // - "shared": Inyecta todos los estilos del documento padre
      // - "isolated": NO inyecta estilos externos (encapsulamiento nativo Shadow DOM)
      // - "fully-isolated": Inyecta SOLO estilos propios de la app

      if (styleMode === 'isolated') {
        // 🔒 MODO ISOLATED: Encapsulamiento nativo del Shadow DOM
        // No se inyectan estilos externos - la app debe manejar sus propios estilos
        logger.wuDebug(`Style mode "isolated" for ${appName}, using native Shadow DOM encapsulation`);
        sandbox.stylesReady = Promise.resolve(0);
        // No configurar observer de estilos - la app es responsable de sus propios estilos

      } else if (styleMode === 'fully-isolated') {
        logger.wuDebug(`Style mode "fully-isolated" detected for ${appName}, using enhanced style injection`);
        // Registrar esta app como fully-isolated en el style bridge para filtrar sus estilos
        const appUrl = options.appUrl || (options.manifest?.name ? `/${options.manifest.name}/` : `/${appName}/`);
        this.styleBridge.registerFullyIsolatedApp(appName, appUrl);

        // Guardar appUrl en sandbox para uso en reinjectStyles
        sandbox.appUrl = appUrl;

        // Para fully-isolated, inyectar SOLO los estilos propios de la app en su Shadow DOM
        // Guardamos referencia a this para usar en el observer
        const self = this;

        sandbox.stylesReady = new Promise((resolve) => {
          let resolved = false;

          const tryInject = async () => {
            const count = await self.injectOwnStylesToShadow(shadowRoot, appName, appUrl);

            if (count > 0) {
              logger.wuDebug(`Injected ${count} own styles for ${appName} (fully-isolated)`);
              if (!resolved) {
                resolved = true;
                resolve(count);
              }
            }

            return count;
          };

          // Usar MutationObserver PERSISTENTE para detectar cuando se inyectan estilos del app
          logger.wuDebug(`Setting up style observer for ${appName} (fully-isolated)`);
          const observer = new MutationObserver((mutations) => {
            let newStyleCount = 0;
            for (const m of mutations) {
              if (m.type === 'childList') {
                for (const n of m.addedNodes) {
                  if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') {
                    newStyleCount++;
                    const viteId = n.getAttribute ? n.getAttribute('data-vite-dev-id') : null;
                    if (viteId && viteId.toLowerCase().includes(appName.toLowerCase())) {
                      logger.wuDebug(`New ${appName} style detected: ${viteId.split('/').pop()}`);
                    }
                  }
                }
              }
            }
            if (newStyleCount > 0) {
              logger.wuDebug(`${newStyleCount} new styles detected in head, checking for ${appName}...`);
              tryInject();
            }
          });

          // Observar cambios en el head DE FORMA PERSISTENTE
          observer.observe(document.head, {
            childList: true,
            subtree: true
          });

          // Guardar referencia al observer para poder desconectarlo cuando se desmonte la app
          sandbox.styleObserver = observer;

          // Intento inicial con pequeño delay para que Vite procese los imports
          setTimeout(async () => {
            const count = await tryInject();
            // Si después de 3 segundos no hay estilos, usar fallback
            if (!resolved) {
              setTimeout(() => {
                if (!resolved) {
                  logger.wuWarn(`No own styles found for ${appName} after timeout, using FALLBACK`);
                  const fallbackCount = self.injectAllStylesToShadow(shadowRoot, appName);
                  logger.wuDebug(`FALLBACK: Injected ${fallbackCount} styles for ${appName}`);
                  resolved = true;
                  resolve(fallbackCount);
                }
              }, 3000);
            }
          }, 50);
        });
      } else {
        // 🌐 MODO SHARED (default): Inyectar todos los estilos compartidos del documento
        logger.wuDebug(`Style mode "shared" for ${appName}, injecting all shared styles...`);
        sandbox.stylesReady = this.styleBridge.injectStylesIntoShadow(shadowRoot, appName, styleMode).then(count => {
          logger.wuDebug(`Shared ${count} styles with ${appName}`);

          // 🔄 Observar cambios dinámicos de estilos (HMR de Vite)
          this.styleBridge.observeStyleChanges(() => {
            logger.wuDebug(`Reinjecting styles for ${appName} due to changes`);
            this.styleBridge.injectStylesIntoShadow(shadowRoot, appName, styleMode).catch(err => {
              logger.wuWarn(`Failed to reinject styles: ${err}`);
            });
          });

          return count;
        }).catch(error => {
          logger.wuWarn(`Failed to inject styles: ${error}`);
          return 0;
        });
      }

      // 📊 Register in sandbox registry
      this.sandboxes.set(appName, sandbox);

      logger.wuDebug(`Enhanced sandbox created for ${appName}`);
      return sandbox;

    } catch (error) {
      logger.wuError(`Failed to create sandbox for ${appName}: ${error}`);

      // 🔧 FALLBACK RECOVERY: Create fallback sandbox when Shadow DOM fails
      if (error.message.includes('Shadow root cannot be created')) {
        return this.createFallbackSandbox(appName, hostContainer);
      }

      throw error;
    }
  }

  /**
   * 🔧 FALLBACK SANDBOX: Create fallback container when Shadow DOM is not available
   */
  createFallbackSandbox(appName, hostContainer) {
    logger.wuDebug(`Creating fallback sandbox for ${appName}...`);

    try {
      // 🛠️ Complete shadow DOM reset
      if (hostContainer.shadowRoot) {
        hostContainer.shadowRoot.innerHTML = '';
      }

      // 🌟 Create minimal container without shadow DOM if necessary
      const fallbackContainer = document.createElement('div');
      fallbackContainer.id = `wu-app-${appName}`;
      fallbackContainer.className = 'wu-app-root wu-fallback';
      fallbackContainer.style.cssText = `
        width: 100%;
        height: 100%;
        isolation: isolate;
        contain: layout style paint;
      `;

      // 🧹 Clear host container
      hostContainer.innerHTML = '';
      hostContainer.appendChild(fallbackContainer);

      const healedSandbox = {
        appName,
        shadowRoot: null, // No shadow DOM in fallback mode
        container: fallbackContainer,
        hostContainer,
        styles: null,
        created: Date.now(),
        sandbox_state: 'fallback_mode',
        recovery_count: 1,
        fallback_mode: true
      };

      this.sandboxes.set(appName, healedSandbox);

      logger.wuDebug(`Fallback sandbox created successfully for ${appName}`);
      return healedSandbox;

    } catch (healingError) {
      logger.wuError(`Fallback sandbox creation failed: ${healingError}`);
      throw healingError;
    }
  }

  /**
   * 🎨 SANDBOX STYLES: Generate CSS styles for Shadow DOM isolation
   */
  generateSandboxStyles(appName) {
    return `
      /* Wu Framework - Shadow DOM Isolation Styles */
      :host {
        display: block;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        contain: layout style paint;
        --wu-sandbox-active: true;
        --wu-isolation-state: stable;
      }

      .wu-app-root {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        isolation: isolate;
        position: relative;
        overflow: hidden;
      }

      /* Loading animation for sandbox initialization */
      .wu-app-root[data-wu-loading="true"] {
        background: linear-gradient(45deg,
          rgba(74, 144, 226, 0.1) 0%,
          rgba(80, 227, 194, 0.1) 100%);
        animation: sandboxPulse 2s ease-in-out infinite;
      }

      @keyframes sandboxPulse {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }

      /* CSS reset for shadow DOM stability */
      * {
        box-sizing: border-box;
      }

      /* CSS custom properties for sandbox */
      :host {
        --wu-app-name: "${appName}";
        --wu-isolation: true;
        --wu-creation-timestamp: ${Date.now()};
      }

      /* 🛡️ Debug mode enhancements */
      :host([wu-debug]) {
        border: 2px dashed #4a90e2;
        background: rgba(74, 144, 226, 0.05);
        box-shadow: 0 0 10px rgba(74, 144, 226, 0.3);
      }

      :host([wu-debug])::before {
        content: "Wu Framework: " attr(wu-app);
        position: absolute;
        top: 0;
        left: 0;
        background: linear-gradient(45deg, #4a90e2, #50e3c2);
        color: white;
        padding: 4px 8px;
        font-size: 11px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        z-index: 10000;
        border-radius: 0 0 4px 0;
        font-weight: 600;
      }

      /* Sandbox state indicators */
      :host([data-sandbox-state="stable"]) {
        --wu-isolation-state: stable;
      }

      :host([data-sandbox-state="healing"]) {
        --wu-dimensional-stability: healing;
        animation: sandboxHealing 1s ease-in-out infinite;
      }

      @keyframes sandboxHealing {
        0%, 100% { filter: hue-rotate(0deg); }
        50% { filter: hue-rotate(180deg); }
      }
    `;
  }

  /**
   * 🛡️ Crear JS Sandbox avanzado (ProxySandbox o SnapshotSandbox)
   * @param {string} appName - Nombre de la app
   * @returns {WuProxySandbox|WuSnapshotSandbox} Sandbox JS
   */
  createAdvancedJSSandbox(appName) {
    let jsSandbox;

    if (this.sandboxStrategy === 'proxy') {
      jsSandbox = new WuProxySandbox(appName);
      logger.wuDebug(`Created ProxySandbox for ${appName}`);
    } else {
      jsSandbox = new WuSnapshotSandbox(appName);
      logger.wuDebug(`Created SnapshotSandbox for ${appName}`);
    }

    // Registrar sandbox
    this.jsSandboxes.set(appName, jsSandbox);

    return jsSandbox;
  }

  /**
   * Agregar estilos personalizados al sandbox
   * @param {string} appName - Nombre de la aplicación
   * @param {string} css - CSS a agregar
   */
  addStyles(appName, css) {
    const sandbox = this.sandboxes.get(appName);
    if (!sandbox) {
      logger.wuWarn(`Sandbox not found for: ${appName}`);
      return;
    }

    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    styleElement.setAttribute('wu-custom-styles', '');

    sandbox.shadowRoot.appendChild(styleElement);
    logger.wuDebug(`Custom styles added to ${appName}`);
  }

  /**
   * Cargar estilos externos en el sandbox
   * @param {string} appName - Nombre de la aplicación
   * @param {string} href - URL del CSS
   */
  loadExternalStyles(appName, href) {
    const sandbox = this.sandboxes.get(appName);
    if (!sandbox) {
      logger.wuWarn(`Sandbox not found for: ${appName}`);
      return;
    }

    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = href;
    linkElement.setAttribute('wu-external-styles', '');

    sandbox.shadowRoot.appendChild(linkElement);
    logger.wuDebug(`External styles loaded in ${appName}: ${href}`);
  }

  /**
   * Establecer modo debug para un sandbox
   * @param {string} appName - Nombre de la aplicación
   * @param {boolean} enabled - Activar/desactivar debug
   */
  setDebugMode(appName, enabled = true) {
    const sandbox = this.sandboxes.get(appName);
    if (!sandbox) {
      logger.wuWarn(`Sandbox not found for: ${appName}`);
      return;
    }

    if (enabled) {
      sandbox.hostContainer.setAttribute('wu-debug', '');
      sandbox.hostContainer.setAttribute('wu-app', appName);
    } else {
      sandbox.hostContainer.removeAttribute('wu-debug');
      sandbox.hostContainer.removeAttribute('wu-app');
    }

    logger.wuDebug(`Debug mode ${enabled ? 'enabled' : 'disabled'} for ${appName}`);
  }

  /**
   * Limpiar y destruir sandbox
   * @param {Object} sandbox - Sandbox a limpiar
   */
  cleanup(sandbox) {
    if (!sandbox) return;

    const { appName, shadowRoot, hostContainer, jsSandbox } = sandbox;

    logger.wuDebug(`Cleaning up sandbox for: ${appName}`);

    try {
      // 🛡️ NUEVO: Desactivar JS Sandbox
      if (jsSandbox && jsSandbox.isActive()) {
        jsSandbox.deactivate();
        logger.wuDebug(`JS Sandbox deactivated for ${appName}`);
      }

      // Limpiar eventos y observers
      this.cleanupEventListeners(sandbox);

      // Limpiar contenido del Shadow DOM
      if (shadowRoot) {
        shadowRoot.innerHTML = '';
      }

      // Remover atributos del host
      if (hostContainer) {
        hostContainer.removeAttribute('wu-debug');
        hostContainer.removeAttribute('wu-app');
        hostContainer.removeAttribute('wu-no-scroll');
      }

      // Remover del registro
      this.sandboxes.delete(appName);
      this.jsSandboxes.delete(appName);

      logger.wuDebug(`Sandbox cleaned up: ${appName}`);

    } catch (error) {
      logger.wuError(`Error cleaning up sandbox ${appName}: ${error}`);
    }
  }

  /**
   * Limpiar event listeners del sandbox
   * @param {Object} sandbox - Sandbox a limpiar
   */
  cleanupEventListeners(sandbox) {
    // Remover todos los event listeners del Shadow DOM
    const { shadowRoot } = sandbox;
    if (!shadowRoot) return;

    // Clonar nodos para remover todos los event listeners
    const elements = shadowRoot.querySelectorAll('*');
    elements.forEach(element => {
      if (element.cloneNode) {
        const clone = element.cloneNode(true);
        element.parentNode?.replaceChild(clone, element);
      }
    });
  }

  /**
   * Obtener información de un sandbox
   * @param {string} appName - Nombre de la aplicación
   * @returns {Object} Información del sandbox
   */
  getSandboxInfo(appName) {
    const sandbox = this.sandboxes.get(appName);
    if (!sandbox) return null;

    return {
      appName: sandbox.appName,
      created: sandbox.created,
      hasContainer: !!sandbox.container,
      hasShadowRoot: !!sandbox.shadowRoot,
      elementCount: sandbox.shadowRoot?.children?.length || 0,
      uptime: Date.now() - sandbox.created
    };
  }

  /**
   * Obtener estadísticas de todos los sandboxes
   */
  getStats() {
    return {
      strategy: this.sandboxStrategy,
      total: this.sandboxes.size,
      sandboxes: Array.from(this.sandboxes.keys()),
      jsSandboxes: Array.from(this.jsSandboxes.keys()),
      details: Array.from(this.sandboxes.entries()).map(([name, sandbox]) => ({
        name,
        uptime: Date.now() - sandbox.created,
        elements: sandbox.shadowRoot?.children?.length || 0,
        hasJsSandbox: !!sandbox.jsSandbox,
        jsSandboxActive: sandbox.jsSandbox?.isActive() || false
      }))
    };
  }

  /**
   * Limpiar todos los sandboxes
   */
  cleanupAll() {
    logger.wuDebug(`Cleaning up all ${this.sandboxes.size} sandboxes...`);

    for (const [appName, sandbox] of this.sandboxes) {
      this.cleanup(sandbox);
    }

    // Limpiar StyleBridge
    if (this.styleBridge) {
      this.styleBridge.cleanup();
    }

    logger.wuDebug('All sandboxes cleaned up');
  }

  /**
   * 🎨 CONFIGURAR STYLE BRIDGE: Configura el sistema de compartición de estilos
   * @param {Object} config - Configuración del StyleBridge
   */
  configureStyleSharing(config) {
    if (this.styleBridge) {
      this.styleBridge.configure(config);
      logger.wuDebug('StyleBridge configured');
    }
  }

  /**
   * 📊 OBTENER ESTADÍSTICAS DE ESTILOS: Info sobre estilos compartidos
   * @returns {Object}
   */
  getStyleStats() {
    return this.styleBridge ? this.styleBridge.getStats() : null;
  }

  /**
   * 🔄 RE-INYECTAR ESTILOS: Vuelve a inyectar estilos en un sandbox
   * @param {string} appName - Nombre de la aplicación
   */
  async reinjectStyles(appName) {
    const sandbox = this.sandboxes.get(appName);
    if (!sandbox || !sandbox.shadowRoot) {
      logger.wuWarn(`Cannot reinject styles for ${appName}`);
      return;
    }

    const styleMode = sandbox.styleMode;

    // 🔒 MODO ISOLATED: No reinyectar estilos - la app maneja sus propios estilos
    if (styleMode === 'isolated') {
      logger.wuDebug(`Skipping reinject for ${appName} (isolated mode - app manages own styles)`);
      return;
    }

    // 🛡️ MODO FULLY-ISOLATED: Reinyectar SOLO estilos propios
    if (styleMode === 'fully-isolated') {
      logger.wuDebug(`Reinjecting OWN styles for ${appName} (fully-isolated)...`);
      const appUrl = sandbox.appUrl || sandbox.manifest?.name ? `/${sandbox.manifest.name}/` : `/${appName}/`;
      const count = await this.injectOwnStylesToShadow(sandbox.shadowRoot, appName, appUrl);
      logger.wuDebug(`Reinjected ${count} own styles for ${appName}`);
      return;
    }

    // 🌐 MODO SHARED: Reinyectar todos los estilos compartidos
    logger.wuDebug(`Reinjecting shared styles for ${appName}...`);
    const count = await this.styleBridge.injectStylesIntoShadow(
      sandbox.shadowRoot,
      appName,
      styleMode
    );
    logger.wuDebug(`Reinjected ${count} shared styles`);
  }

  /**
   * 🎨 INYECTAR ESTILOS PROPIOS: Inyecta SOLO los estilos propios de una app en su Shadow DOM
   * Usado para apps en modo fully-isolated
   * @param {ShadowRoot} shadowRoot - Shadow DOM donde inyectar
   * @param {string} appName - Nombre de la app
   * @param {string} appUrl - URL base de la app
   * @returns {Promise<number>} Número de estilos inyectados
   */
  async injectOwnStylesToShadow(shadowRoot, appName, appUrl) {
    if (!shadowRoot) return 0;

    let injectedCount = 0;

    // Buscar TODOS los estilos en el head
    const allStyles = document.querySelectorAll('style');
    const normalizedAppName = appName.toLowerCase();

    // Patrones para detectar estilos de esta app (Windows y Unix paths)
    // IMPORTANTE: Debe coincidir SOLO con packages/appName/ al inicio del path del paquete
    // NO debe coincidir con packages/shell/src/components/learning/ (eso es del shell)
    const appPatterns = [
      // Patrón específico: packages/learning/src o packages\learning\src
      // El src/ es clave para asegurar que es el MFE, no un subdirectorio de otro package
      new RegExp(`packages[/\\\\]${normalizedAppName}[/\\\\]src[/\\\\]`, 'i')
    ];

    logger.wuDebug(`Searching own styles for ${appName}, found ${allStyles.length} style tags in head`);

    // Log para debug: mostrar estilos que contienen el nombre de la app
    let matchingCount = 0;
    for (const s of allStyles) {
      const vid = s.getAttribute('data-vite-dev-id') || '';
      if (vid.toLowerCase().includes(normalizedAppName)) {
        matchingCount++;
      }
    }
    if (matchingCount > 0) {
      logger.wuDebug(`Found ${matchingCount} styles potentially matching ${appName}`);
    }

    for (const style of allStyles) {
      // NO saltar basándose en data-wu-injected del head - eso se pone en los clones del shadow DOM

      const viteId = style.getAttribute('data-vite-dev-id') || '';
      const normalizedViteId = viteId.replace(/\\/g, '/').toLowerCase();

      // Verificar si el estilo pertenece a esta app
      let belongsToApp = false;

      // 1. Por data-vite-dev-id (la forma más confiable)
      if (viteId) {
        // Revisar si el path contiene packages/appName/
        for (const pattern of appPatterns) {
          if (pattern instanceof RegExp) {
            if (pattern.test(viteId)) {
              belongsToApp = true;
              break;
            }
          } else {
            if (normalizedViteId.includes(pattern.toLowerCase())) {
              belongsToApp = true;
              break;
            }
          }
        }
      }

      if (belongsToApp) {
        // Verificar si ya existe en el Shadow DOM
        const existingStyle = shadowRoot.querySelector(`style[data-vite-dev-id="${viteId}"]`);

        if (!existingStyle) {
          const clonedStyle = style.cloneNode(true);
          clonedStyle.setAttribute('data-wu-injected', 'true');
          shadowRoot.insertBefore(clonedStyle, shadowRoot.firstChild);
          injectedCount++;
          const styleName = viteId.substring(viteId.lastIndexOf('/') + 1) || viteId.substring(viteId.lastIndexOf('\\') + 1);
          logger.wuDebug(`Injected own style for ${appName}: ${styleName}`);
        }
      }
    }

    logger.wuDebug(`Total own styles injected for ${appName}: ${injectedCount}`);
    return injectedCount;
  }

  /**
   * 🎨 FALLBACK: Inyectar estilos que contengan el nombre de la app
   * Usado como último recurso cuando no se encuentran los estilos con el patrón exacto
   * @param {ShadowRoot} shadowRoot - Shadow DOM donde inyectar
   * @param {string} appName - Nombre de la app (para logging)
   * @returns {number} Número de estilos inyectados
   */
  injectAllStylesToShadow(shadowRoot, appName) {
    if (!shadowRoot) return 0;

    let injectedCount = 0;
    const normalizedAppName = appName.toLowerCase();

    // Inyectar estilos que contengan el nombre de la app en su vite-id
    const allStyles = document.querySelectorAll('style');
    for (const style of allStyles) {
      const viteId = style.getAttribute('data-vite-dev-id') || '';

      // Solo inyectar si contiene el nombre de la app
      if (!viteId.toLowerCase().includes(normalizedAppName)) continue;

      // Verificar si ya existe en el shadow DOM
      if (shadowRoot.querySelector(`style[data-vite-dev-id="${viteId}"]`)) continue;

      const clonedStyle = style.cloneNode(true);
      clonedStyle.setAttribute('data-wu-fallback', 'true');
      shadowRoot.insertBefore(clonedStyle, shadowRoot.firstChild);
      injectedCount++;
      const styleName = viteId.split('/').pop() || viteId.split('\\').pop();
      logger.wuDebug(`FALLBACK injected: ${styleName}`);
    }

    logger.wuDebug(`FALLBACK: Total ${injectedCount} styles injected for ${appName}`);
    return injectedCount;
  }
}
