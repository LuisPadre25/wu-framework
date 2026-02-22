/**
 * 🎨 WU-STYLE-BRIDGE: SHADOW DOM STYLE SHARING SYSTEM
 *
 * Comparte automáticamente estilos de node_modules entre padre e hijos Shadow DOM
 * Soluciona el problema de aislamiento CSS en microfrontends
 *
 * MODOS DE INYECCIÓN DE ESTILOS:
 * ================================
 *
 * 1. "shared" (default):
 *    - Inyecta TODOS los estilos del documento padre en el Shadow DOM
 *    - Incluye: librerías (Element Plus, Vue Flow), estilos globales, etc.
 *    - Ideal para: Apps que necesitan compartir un design system común
 *    - Riesgo de colisiones: ALTO
 *
 * 2. "isolated":
 *    - NO inyecta estilos externos
 *    - Usa el encapsulamiento NATIVO del Shadow DOM
 *    - La app debe incluir sus propios estilos (CSS-in-JS, scoped styles, etc.)
 *    - Ideal para: Apps con estilos completamente independientes
 *    - Riesgo de colisiones: NINGUNO
 *
 * 3. "fully-isolated":
 *    - Inyecta SOLO los estilos propios de la micro-app específica
 *    - Detecta estilos por patrón: packages/appName/src/
 *    - Usa MutationObserver para HMR de Vite
 *    - Ideal para: Apps que necesitan sus estilos pero no los globales
 *    - Riesgo de colisiones: NINGUNO
 */

import { logger } from './wu-logger.js';

export class WuStyleBridge {
  constructor() {
    this.styleObserver = null;
    this.fullyIsolatedApps = new Map(); // Mapa de appName -> appUrl para apps con fully-isolated
    this.config = {
      // Librerías que se deben compartir automáticamente
      autoShareLibraries: [
        'element-plus',
        'vue-flow',
        '@vue-flow',
        'vueuse',
        '@vueuse',
        'normalize.css',
        'reset.css'
      ],
      // Patrones de URLs a compartir
      sharePatterns: [
        /\/node_modules\//,
        /\/@vite\/client/,
        /\/dist\/index\.css$/,
        /\/dist\/style\.css$/
      ],
      // Modo de compartición
      mode: 'auto', // 'auto' | 'manual' | 'all'
      // Caché de estilos
      cacheEnabled: true
    };

    logger.debug('[WuStyleBridge] 🎨 Style sharing system initialized');
  }

  /**
   * 🛡️ REGISTRAR APP FULLY-ISOLATED: Registra una app con fully-isolated para filtrar sus estilos
   * @param {string} appName - Nombre de la app
   * @param {string} appUrl - URL base de la app
   */
  registerFullyIsolatedApp(appName, appUrl) {
    this.fullyIsolatedApps.set(appName, appUrl);
    logger.debug(`[WuStyleBridge] 🛡️ Registered fully-isolated app: ${appName} (${appUrl})`);
  }

  /**
   * 🔍 VERIFICAR SI ESTILO ES DE APP FULLY-ISOLATED: Verifica si un estilo proviene de una app con fully-isolated
   * @param {string|Object|HTMLElement} styleUrlOrElement - URL del estilo, objeto de estilo, o elemento DOM
   * @returns {boolean}
   */
  isStyleFromFullyIsolatedApp(styleUrlOrElement) {
    let url = '';
    
    // Si es un string, usar directamente
    if (typeof styleUrlOrElement === 'string') {
      url = styleUrlOrElement;
    }
    // Si es un elemento DOM (HTMLElement) - verificar si tiene getAttribute (método común de elementos DOM)
    else if (styleUrlOrElement && typeof styleUrlOrElement.getAttribute === 'function') {
      // Obtener data-vite-dev-id o href del elemento
      url = styleUrlOrElement.getAttribute('data-vite-dev-id') || styleUrlOrElement.href || '';
    }
    // Si es un objeto con propiedades
    else if (styleUrlOrElement) {
      if (styleUrlOrElement.href) {
        url = styleUrlOrElement.href;
      } else if (styleUrlOrElement.viteId) {
        url = styleUrlOrElement.viteId;
      } else if (styleUrlOrElement.element) {
        if (typeof styleUrlOrElement.element.getAttribute === 'function') {
          url = styleUrlOrElement.element.getAttribute('data-vite-dev-id') || styleUrlOrElement.element.href || '';
        } else if (styleUrlOrElement.element.href) {
          url = styleUrlOrElement.element.href;
        }
      }
    }

    if (!url || url.trim() === '') return false;

    // Normalizar la URL para comparación (convertir backslashes a forward slashes)
    const normalizedUrl = url.replace(/\\/g, '/').toLowerCase();

    // Verificar si la URL pertenece a alguna app con fully-isolated
    for (const [appName, appUrl] of this.fullyIsolatedApps.entries()) {
      const normalizedAppUrl = appUrl.replace(/\\/g, '/').toLowerCase();
      const normalizedAppName = appName.toLowerCase();
      
      // Verificar si la URL contiene la URL base de la app (ej: http://localhost:4001)
      if (normalizedAppUrl && normalizedUrl.includes(normalizedAppUrl)) {
        return true;
      }
      
      // Verificar si la URL contiene rutas del app en el sistema de archivos
      // Ej: C:/Users/.../header/src/... o /header/src/...
      // Patrón: cualquier ruta que contenga /header/ o \header\
      const appPathPattern = new RegExp(`[/\\\\]${normalizedAppName}[/\\\\]`, 'i');
      if (appPathPattern.test(normalizedUrl)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 🔍 DETECTAR ESTILOS: Escanea todos los estilos del documento
   * @returns {Array} Lista de estilos detectados (filtrados para excluir apps con fully-isolated)
   */
  detectDocumentStyles() {
    const styles = [];

    // 1. Detectar TODOS los <link> tags de CSS
    const linkTags = document.querySelectorAll('link[rel="stylesheet"]');
    linkTags.forEach((link) => {
      // Filtrar estilos de apps con fully-isolated
      if (this.isStyleFromFullyIsolatedApp(link)) {
        return;
      }

      styles.push({
        type: 'link',
        href: link.href,
        element: link,
        library: this.extractLibraryName(link.href)
      });
    });

    // 2. Detectar TODOS los <style> tags (incluyendo Vue scoped styles)
    const styleTags = document.querySelectorAll('style');
    styleTags.forEach((style, index) => {
      // Excluir solo estilos ya compartidos por wu-framework
      if (style.getAttribute('data-wu-shared') === 'true') {
        return;
      }

      const viteId = style.getAttribute('data-vite-dev-id');
      const content = style.textContent;

      // Filtrar estilos de apps con fully-isolated (después de obtener viteId para mejor detección)
      if (this.isStyleFromFullyIsolatedApp(style) || (viteId && this.isStyleFromFullyIsolatedApp(viteId))) {
        logger.debug(`[WuStyleBridge] 🛡️ Filtered out style from fully-isolated app: ${viteId || 'unknown'}`);
        return;
      }

      // Incluir todos los estilos con contenido
      if (content && content.trim().length > 0) {
        styles.push({
          type: 'inline',
          content,
          element: style,
          viteId,
          library: this.extractLibraryName(viteId || ''),
          index
        });
      }
    });

    // 3. Detectar Constructable Stylesheets (si están disponibles)
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
      document.adoptedStyleSheets.forEach((sheet, index) => {
        styles.push({
          type: 'adoptedStyleSheet',
          sheet,
          index
        });
      });
    }

    logger.debug(`[WuStyleBridge] 🔍 Detected ${styles.length} shareable styles`);
    return styles;
  }

  /**
   * 🎯 VERIFICAR SI SE DEBE COMPARTIR: Filtra estilos según configuración
   * @param {string} urlOrId - URL o ID del estilo
   * @returns {boolean}
   */
  shouldShareStyle(urlOrId) {
    if (!urlOrId) return false;

    // Modo 'all' - compartir todo
    if (this.config.mode === 'all') return true;

    // Verificar patrones configurados
    for (const pattern of this.config.sharePatterns) {
      if (pattern.test(urlOrId)) return true;
    }

    // Verificar librerías específicas
    for (const lib of this.config.autoShareLibraries) {
      if (urlOrId.includes(lib)) return true;
    }

    return false;
  }

  /**
   * 📦 EXTRAER NOMBRE DE LIBRERÍA: Obtiene el nombre de la librería desde la URL
   * @param {string} url - URL del estilo
   * @returns {string|null}
   */
  extractLibraryName(url) {
    if (!url) return null;

    // Extraer de node_modules
    const nodeModulesMatch = url.match(/\/node_modules\/(@?[^/]+\/[^/]+|@?[^/]+)/);
    if (nodeModulesMatch) return nodeModulesMatch[1];

    // Extraer de vite dev id
    const viteMatch = url.match(/\/node_modules\/(.+?)\/.*?\.css/);
    if (viteMatch) return viteMatch[1];

    return null;
  }

  /**
   * 🌉 INYECTAR ESTILOS EN SHADOW DOM: Clona estilos al Shadow DOM
   * @param {ShadowRoot} shadowRoot - Shadow DOM donde inyectar
   * @param {string} appName - Nombre de la app
   * @param {string} styleMode - Modo de estilos: 'shared', 'isolated', 'fully-isolated'
   * @returns {Promise<number>}
   */
  async injectStylesIntoShadow(shadowRoot, appName, styleMode) {
    if (!shadowRoot) {
      logger.warn('[WuStyleBridge] ⚠️ No shadow root provided');
      return 0;
    }

    // 🛡️ MODO FULLY-ISOLATED: No inyectar ningún estilo compartido
    // Los estilos propios se manejan en wu-sandbox.js con injectOwnStylesToShadow
    if (styleMode === 'fully-isolated') {
      logger.debug(`[WuStyleBridge] 🛡️ Style mode "fully-isolated" for ${appName}, skipping shared style injection`);
      return 0;
    }

    // 🔒 MODO ISOLATED: No inyectar estilos externos - usar encapsulamiento nativo de Shadow DOM
    // La app debe manejar sus propios estilos (CSS-in-JS, scoped styles, imports directos)
    if (styleMode === 'isolated') {
      logger.debug(`[WuStyleBridge] 🔒 Style mode "isolated" for ${appName}, using native Shadow DOM encapsulation (no external styles)`);
      return 0;
    }

    // 🌐 MODO SHARED (default): Inyectar todos los estilos compartidos del documento
    logger.debug(`[WuStyleBridge] 🌐 Style mode "shared" for ${appName}, injecting all shared styles...`);

    // Detectar estilos del documento
    const styles = this.detectDocumentStyles();
    let injectedCount = 0;

    // Inyectar cada estilo
    for (const style of styles) {
      try {
        switch (style.type) {
          case 'link':
            await this.injectLinkStyle(shadowRoot, style);
            injectedCount++;
            break;

          case 'inline':
            this.injectInlineStyle(shadowRoot, style);
            injectedCount++;
            break;

          case 'adoptedStyleSheet':
            this.injectAdoptedStyleSheet(shadowRoot, style);
            injectedCount++;
            break;
        }
      } catch (error) {
        logger.warn(`[WuStyleBridge] ⚠️ Failed to inject style:`, error);
      }
    }

    logger.debug(`[WuStyleBridge] ✅ Injected ${injectedCount} shared styles into ${appName}`);
    return injectedCount;
  }

  /**
   * 🔗 INYECTAR LINK STYLE: Clona <link> tag al Shadow DOM
   * @param {ShadowRoot} shadowRoot
   * @param {Object} style
   */
  async injectLinkStyle(shadowRoot, style) {
    // Verificar si ya existe
    const existing = shadowRoot.querySelector(`link[href="${style.href}"]`);
    if (existing) {
      logger.debug(`[WuStyleBridge] ⏭️ Style already exists: ${style.library || style.href}`);
      return;
    }

    // Clonar link tag
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = style.href;
    link.setAttribute('data-wu-shared', 'true');
    link.setAttribute('data-wu-library', style.library || 'unknown');

    // Insertar al principio del shadow root (antes de otros estilos)
    shadowRoot.insertBefore(link, shadowRoot.firstChild);

    logger.debug(`[WuStyleBridge] 🔗 Injected link: ${style.library || style.href}`);
  }

  /**
   * 📝 INYECTAR INLINE STYLE: Clona <style> tag al Shadow DOM
   * @param {ShadowRoot} shadowRoot
   * @param {Object} style
   */
  injectInlineStyle(shadowRoot, style) {
    // Verificar si ya existe
    const viteId = style.viteId;
    if (viteId) {
      const existing = shadowRoot.querySelector(`style[data-wu-vite-id="${viteId}"]`);
      if (existing) {
        logger.debug(`[WuStyleBridge] ⏭️ Inline style already exists: ${viteId}`);
        return;
      }
    }

    // Crear nuevo style tag
    const styleTag = document.createElement('style');
    styleTag.textContent = style.content;
    styleTag.setAttribute('data-wu-shared', 'true');
    styleTag.setAttribute('data-wu-library', style.library || 'unknown');
    if (viteId) {
      styleTag.setAttribute('data-wu-vite-id', viteId);
    }

    // Insertar al principio del shadow root
    shadowRoot.insertBefore(styleTag, shadowRoot.firstChild);

    logger.debug(`[WuStyleBridge] 📝 Injected inline style: ${style.library || viteId}`);
  }

  /**
   * 📋 INYECTAR ADOPTED STYLESHEET: Comparte stylesheet constructable
   * @param {ShadowRoot} shadowRoot
   * @param {Object} style
   */
  injectAdoptedStyleSheet(shadowRoot, style) {
    try {
      // Agregar stylesheet al array de adopted stylesheets
      if (!shadowRoot.adoptedStyleSheets) {
        shadowRoot.adoptedStyleSheets = [];
      }

      // Verificar si ya existe
      if (shadowRoot.adoptedStyleSheets.includes(style.sheet)) {
        logger.debug(`[WuStyleBridge] ⏭️ Adopted stylesheet already exists`);
        return;
      }

      shadowRoot.adoptedStyleSheets = [
        ...shadowRoot.adoptedStyleSheets,
        style.sheet
      ];

      logger.debug(`[WuStyleBridge] 📋 Injected adopted stylesheet`);
    } catch (error) {
      logger.warn(`[WuStyleBridge] ⚠️ Failed to inject adopted stylesheet:`, error);
    }
  }

  /**
   * 🔄 OBSERVAR CAMBIOS: Monitorea nuevos estilos en el documento
   * @param {Function} callback - Callback cuando se detectan cambios
   */
  observeStyleChanges(callback) {
    // Limpiar observer anterior si existe
    if (this.styleObserver) {
      this.styleObserver.disconnect();
    }

    // Crear MutationObserver para detectar nuevos estilos
    this.styleObserver = new MutationObserver((mutations) => {
      let hasStyleChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Verificar si se agregaron <link> o <style> tags
          const addedNodes = Array.from(mutation.addedNodes);
          const hasNewStyles = addedNodes.some(node =>
            node.tagName === 'LINK' || node.tagName === 'STYLE'
          );

          if (hasNewStyles) {
            hasStyleChanges = true;
            break;
          }
        }
      }

      if (hasStyleChanges && callback) {
        logger.debug('[WuStyleBridge] 🔄 Style changes detected');
        callback();
      }
    });

    // Observar <head> para cambios en estilos
    this.styleObserver.observe(document.head, {
      childList: true,
      subtree: true
    });

    logger.debug('[WuStyleBridge] 👀 Observing style changes');
  }

  /**
   * ⚙️ CONFIGURAR: Actualiza la configuración
   * @param {Object} config - Nueva configuración
   */
  configure(config) {
    this.config = {
      ...this.config,
      ...config
    };

    logger.debug('[WuStyleBridge] ⚙️ Configuration updated:', this.config);
  }

  /**
   * 🧹 LIMPIAR: Detiene la observación
   */
  cleanup() {
    if (this.styleObserver) {
      this.styleObserver.disconnect();
      this.styleObserver = null;
    }

    logger.debug('[WuStyleBridge] 🧹 StyleBridge cleaned up');
  }

  /**
   * 📊 OBTENER ESTADÍSTICAS: Información sobre estilos compartidos
   * @returns {Object}
   */
  getStats() {
    const styles = this.detectDocumentStyles();

    return {
      totalStyles: styles.length,
      linkStyles: styles.filter(s => s.type === 'link').length,
      inlineStyles: styles.filter(s => s.type === 'inline').length,
      adoptedStyleSheets: styles.filter(s => s.type === 'adoptedStyleSheet').length,
      libraries: [...new Set(styles.map(s => s.library).filter(Boolean))],
      config: this.config
    };
  }
}
