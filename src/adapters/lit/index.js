/**
 * 🚀 WU-FRAMEWORK LIT ADAPTER
 *
 * Simplifica la integración de Lit (Web Components) con Wu Framework.
 * Aprovecha los Web Components nativos con Shadow DOM incluido.
 *
 * @example
 * // Microfrontend (main.js)
 * import { wuLit } from 'wu-framework/adapters/lit';
 * import { MyApp } from './my-app';
 *
 * wuLit.register('my-app', MyApp);
 *
 * @example
 * // Usando LitElement
 * import { LitElement, html, css } from 'lit';
 *
 * class MyApp extends LitElement {
 *   static styles = css`:host { display: block; }`;
 *
 *   render() {
 *     return html`<h1>Hello from Lit!</h1>`;
 *   }
 * }
 *
 * wuLit.register('my-app', MyApp);
 */

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  elements: new Map(),
  lit: null,
  initialized: false
};

/**
 * Obtiene la instancia de Wu Framework
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;

  return window.wu
    || window.parent?.wu
    || window.top?.wu
    || null;
}

/**
 * Espera a que Wu Framework esté disponible
 */
function waitForWu(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const wu = getWuInstance();
    if (wu) {
      resolve(wu);
      return;
    }

    const startTime = Date.now();

    const handleWuReady = () => {
      cleanup();
      resolve(getWuInstance());
    };

    window.addEventListener('wu:ready', handleWuReady);
    window.addEventListener('wu:app:ready', handleWuReady);

    const checkInterval = setInterval(() => {
      const wu = getWuInstance();
      if (wu) {
        cleanup();
        resolve(wu);
        return;
      }

      if (Date.now() - startTime > timeout) {
        cleanup();
        reject(new Error(`Wu Framework not found after ${timeout}ms`));
      }
    }, 200);

    function cleanup() {
      clearInterval(checkInterval);
      window.removeEventListener('wu:ready', handleWuReady);
      window.removeEventListener('wu:app:ready', handleWuReady);
    }
  });
}

/**
 * Genera un nombre de tag válido para Custom Elements
 */
function generateTagName(appName) {
  // Custom elements deben tener un guión
  if (appName.includes('-')) {
    return `wu-${appName}`;
  }
  return `wu-app-${appName}`;
}

/**
 * Registra un LitElement como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {typeof LitElement} ElementClass - Clase que extiende LitElement
 * @param {Object} options - Opciones adicionales
 * @param {string} options.tagName - Nombre del custom element (auto-generado si no se provee)
 * @param {Object} options.properties - Propiedades iniciales
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#root')
 *
 * @example
 * import { LitElement, html } from 'lit';
 *
 * class HeaderApp extends LitElement {
 *   render() {
 *     return html`<header><h1>My Header</h1></header>`;
 *   }
 * }
 *
 * wuLit.register('header', HeaderApp);
 */
async function register(appName, ElementClass, options = {}) {
  const {
    tagName = null,
    properties = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root'
  } = options;

  // Generar nombre de tag
  const customTagName = tagName || generateTagName(appName);

  // Registrar el Custom Element si no existe
  if (!customElements.get(customTagName)) {
    try {
      customElements.define(customTagName, ElementClass);
      console.log(`[WuLit] Custom element <${customTagName}> defined`);
    } catch (error) {
      console.error(`[WuLit] Failed to define custom element:`, error);
      throw error;
    }
  }

  // Guardar referencia de la clase
  adapterState.elements.set(appName, {
    ElementClass,
    tagName: customTagName
  });

  // Función de mount
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuLit] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuLit] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Limpiar container
      container.innerHTML = '';

      // Crear elemento
      const element = document.createElement(customTagName);

      // Aplicar propiedades
      Object.entries(properties).forEach(([key, value]) => {
        element[key] = value;
      });

      // Inyectar información de Wu
      element.wuAppName = appName;
      element.wuInstance = getWuInstance();

      // Agregar al container
      container.appendChild(element);

      // Guardar referencia
      adapterState.apps.set(appName, {
        element,
        container,
        tagName: customTagName
      });

      console.log(`[WuLit] ✅ ${appName} (<${customTagName}>) mounted successfully`);

      if (onMount) {
        onMount(container, element);
      }
    } catch (error) {
      console.error(`[WuLit] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount
  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container, appData.element);
        }

        // Remover elemento
        if (appData.element && appData.element.parentNode) {
          appData.element.remove();
        }

        // Limpiar container
        appData.container.innerHTML = '';

        adapterState.apps.delete(appName);

        console.log(`[WuLit] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuLit] Unmount error for ${appName}:`, error);
      }
    }

    if (container) {
      container.innerHTML = '';
    }
  };

  // Intentar registrar con Wu Framework
  try {
    const wu = await waitForWu(3000);

    wu.define(appName, {
      mount: mountApp,
      unmount: unmountApp
    });

    console.log(`[WuLit] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuLit] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuLit] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Registra un Web Component vanilla (sin Lit) como microfrontend
 *
 * @param {string} appName - Nombre del microfrontend
 * @param {typeof HTMLElement} ElementClass - Clase que extiende HTMLElement
 * @param {Object} options - Opciones
 *
 * @example
 * class MyWebComponent extends HTMLElement {
 *   connectedCallback() {
 *     this.attachShadow({ mode: 'open' });
 *     this.shadowRoot.innerHTML = '<h1>Hello!</h1>';
 *   }
 * }
 *
 * wuLit.registerWebComponent('my-component', MyWebComponent);
 */
async function registerWebComponent(appName, ElementClass, options = {}) {
  // Usar el mismo registro pero para HTMLElement vanilla
  return register(appName, ElementClass, options);
}

/**
 * Crea un LitElement wrapper que carga un microfrontend
 *
 * @example
 * import { html, LitElement } from 'lit';
 * import { createWuSlotElement } from 'wu-framework/adapters/lit';
 *
 * const WuSlot = createWuSlotElement(LitElement, html);
 *
 * // Uso en otro componente
 * render() {
 *   return html`<wu-slot name="header" url="http://localhost:3001"></wu-slot>`;
 * }
 */
function createWuSlotElement(LitElement, html, css) {
  class WuSlotElement extends LitElement {
    static properties = {
      name: { type: String },
      url: { type: String },
      appName: { type: String, attribute: 'app-name' },
      fallbackText: { type: String, attribute: 'fallback-text' },
      loading: { type: Boolean, state: true },
      error: { type: String, state: true }
    };

    static styles = css ? css`
      :host {
        display: block;
        min-height: 100px;
        position: relative;
      }

      .wu-slot-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        color: #666;
      }

      .wu-slot-error {
        padding: 1rem;
        border: 1px solid #f5c6cb;
        border-radius: 4px;
        background: #f8d7da;
        color: #721c24;
      }

      .wu-slot-error strong {
        display: block;
        margin-bottom: 0.5rem;
      }

      .wu-slot-content {
        width: 100%;
        height: 100%;
      }
    ` : [];

    constructor() {
      super();
      this.name = '';
      this.url = '';
      this.appName = null;
      this.fallbackText = null;
      this.loading = true;
      this.error = null;
      this._appInstance = null;
    }

    get actualAppName() {
      return this.appName || this.name;
    }

    async connectedCallback() {
      super.connectedCallback();
      await this.mountMicrofrontend();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.unmountMicrofrontend();
    }

    async mountMicrofrontend() {
      try {
        this.loading = true;
        this.error = null;

        const wu = getWuInstance();
        if (!wu) {
          throw new Error('Wu Framework not initialized');
        }

        // Esperar a que el componente se renderice
        await this.updateComplete;

        const contentSlot = this.shadowRoot.querySelector('.wu-slot-content');
        if (!contentSlot) return;

        const containerId = `wu-slot-${this.actualAppName}-${Date.now()}`;
        const innerContainer = document.createElement('div');
        innerContainer.id = containerId;
        innerContainer.style.cssText = 'width: 100%; height: 100%;';

        contentSlot.innerHTML = '';
        contentSlot.appendChild(innerContainer);

        const app = wu.app(this.actualAppName, {
          url: this.url,
          container: `#${containerId}`,
          autoInit: true
        });

        this._appInstance = app;
        await app.mount();

        this.loading = false;
        this.dispatchEvent(new CustomEvent('wu-load', {
          detail: { name: this.actualAppName, url: this.url },
          bubbles: true,
          composed: true
        }));

      } catch (err) {
        console.error(`[WuSlot] Error loading ${this.actualAppName}:`, err);
        this.error = err.message || 'Failed to load microfrontend';
        this.loading = false;
        this.dispatchEvent(new CustomEvent('wu-error', {
          detail: err,
          bubbles: true,
          composed: true
        }));
      }
    }

    async unmountMicrofrontend() {
      if (this._appInstance) {
        this.dispatchEvent(new CustomEvent('wu-unmount', {
          detail: { name: this.actualAppName },
          bubbles: true,
          composed: true
        }));

        try {
          await this._appInstance.unmount();
        } catch (e) {}

        this._appInstance = null;
      }
    }

    render() {
      if (this.error) {
        return html`
          <div class="wu-slot-error">
            <strong>Error loading ${this.name}</strong>
            <span>${this.error}</span>
          </div>
        `;
      }

      if (this.loading) {
        return html`
          <div class="wu-slot-loading">
            ${this.fallbackText || `Loading ${this.name}...`}
          </div>
          <div class="wu-slot-content"></div>
        `;
      }

      return html`<div class="wu-slot-content"></div>`;
    }
  }

  // Registrar el elemento
  if (!customElements.get('wu-slot')) {
    customElements.define('wu-slot', WuSlotElement);
  }

  return WuSlotElement;
}

/**
 * Mixin para agregar capacidades de Wu a cualquier LitElement
 *
 * @example
 * import { LitElement } from 'lit';
 * import { WuMixin } from 'wu-framework/adapters/lit';
 *
 * class MyElement extends WuMixin(LitElement) {
 *   connectedCallback() {
 *     super.connectedCallback();
 *
 *     // Usar eventos de Wu
 *     this.wuOn('user:login', (data) => {
 *       console.log('User logged in:', data);
 *     });
 *   }
 *
 *   handleClick() {
 *     this.wuEmit('button:clicked', { id: this.id });
 *   }
 * }
 */
function WuMixin(Base) {
  return class extends Base {
    constructor() {
      super();
      this._wuSubscriptions = [];
    }

    get wu() {
      return getWuInstance();
    }

    // Event Bus methods
    wuEmit(event, data, options) {
      const wu = this.wu;
      if (wu?.eventBus) {
        wu.eventBus.emit(event, data, options);
      }
    }

    wuOn(event, callback) {
      const wu = this.wu;
      if (wu?.eventBus) {
        const unsubscribe = wu.eventBus.on(event, callback);
        this._wuSubscriptions.push(unsubscribe);
        return unsubscribe;
      }
      return () => {};
    }

    wuOnce(event, callback) {
      const wu = this.wu;
      if (wu?.eventBus) {
        return wu.eventBus.once(event, callback);
      }
      return () => {};
    }

    // Store methods
    wuGetState(path) {
      const wu = this.wu;
      return wu?.store?.get(path) || null;
    }

    wuSetState(path, value) {
      const wu = this.wu;
      if (wu?.store) {
        wu.store.set(path, value);
      }
    }

    wuOnStateChange(pattern, callback) {
      const wu = this.wu;
      if (wu?.store) {
        const unsubscribe = wu.store.on(pattern, callback);
        this._wuSubscriptions.push(unsubscribe);
        return unsubscribe;
      }
      return () => {};
    }

    // Cleanup
    disconnectedCallback() {
      super.disconnectedCallback();
      this._wuSubscriptions.forEach(unsub => unsub());
      this._wuSubscriptions = [];
    }
  };
}

/**
 * Decorador reactivo para propiedades conectadas al store de Wu
 *
 * @example
 * import { LitElement } from 'lit';
 * import { wuProperty } from 'wu-framework/adapters/lit';
 *
 * class MyElement extends LitElement {
 *   @wuProperty('user.name')
 *   userName;
 *
 *   render() {
 *     return html`<p>Hello, ${this.userName}</p>`;
 *   }
 * }
 */
function wuProperty(storePath) {
  return function(target, propertyKey) {
    const privateKey = `_wu_${propertyKey}`;
    let unsubscribe = null;

    Object.defineProperty(target, propertyKey, {
      get() {
        return this[privateKey];
      },
      set(value) {
        const wu = getWuInstance();
        if (wu?.store) {
          wu.store.set(storePath, value);
        }
      },
      configurable: true,
      enumerable: true
    });

    // Hook into connectedCallback
    const originalConnected = target.connectedCallback;
    target.connectedCallback = function() {
      if (originalConnected) originalConnected.call(this);

      const wu = getWuInstance();
      if (wu?.store) {
        // Set initial value
        this[privateKey] = wu.store.get(storePath);

        // Subscribe to changes
        unsubscribe = wu.store.on(storePath, (value) => {
          this[privateKey] = value;
          this.requestUpdate();
        });
      }
    };

    // Hook into disconnectedCallback
    const originalDisconnected = target.disconnectedCallback;
    target.disconnectedCallback = function() {
      if (originalDisconnected) originalDisconnected.call(this);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  };
}

/**
 * Helper para crear un Web Component simple sin Lit
 *
 * @example
 * const MyComponent = createSimpleElement({
 *   name: 'my-component',
 *   template: '<h1>Hello!</h1>',
 *   styles: ':host { display: block; color: blue; }',
 *   connectedCallback() {
 *     console.log('Connected!');
 *   }
 * });
 */
function createSimpleElement(config) {
  const {
    name,
    template,
    styles = '',
    shadow = true,
    ...callbacks
  } = config;

  class SimpleElement extends HTMLElement {
    constructor() {
      super();
      if (shadow) {
        this.attachShadow({ mode: 'open' });
      }
    }

    connectedCallback() {
      const root = this.shadowRoot || this;

      if (styles) {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        root.appendChild(styleEl);
      }

      if (typeof template === 'function') {
        root.innerHTML += template(this);
      } else {
        root.innerHTML += template;
      }

      if (callbacks.connectedCallback) {
        callbacks.connectedCallback.call(this);
      }
    }

    disconnectedCallback() {
      if (callbacks.disconnectedCallback) {
        callbacks.disconnectedCallback.call(this);
      }
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (callbacks.attributeChangedCallback) {
        callbacks.attributeChangedCallback.call(this, name, oldVal, newVal);
      }
    }
  }

  if (callbacks.observedAttributes) {
    SimpleElement.observedAttributes = callbacks.observedAttributes;
  }

  if (!customElements.get(name)) {
    customElements.define(name, SimpleElement);
  }

  return SimpleElement;
}

// ============================================
// AI INTEGRATION
// ============================================
export { WuAIMixin } from './ai.js';
import { WuAIMixin } from './ai.js';

// API pública del adapter
export const wuLit = {
  register,
  registerWebComponent,
  createWuSlotElement,
  WuMixin,
  WuAIMixin,
  wuProperty,
  createSimpleElement,
  getWuInstance,
  waitForWu
};

export default wuLit;
