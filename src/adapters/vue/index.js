/**
 * 🚀 WU-FRAMEWORK VUE ADAPTER
 *
 * Simplifica la integración de Vue 3 con Wu Framework.
 * Convierte componentes Vue en microfrontends con UNA línea de código.
 *
 * @example
 * // Microfrontend (main.ts)
 * import { wuVue } from 'wu-framework/adapters/vue';
 * import App from './App.vue';
 *
 * wuVue.register('my-app', App);
 *
 * @example
 * // Shell (cargar microfrontend)
 * import { WuSlot } from 'wu-framework/adapters/vue';
 *
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */

import { logger } from '../../core/wu-logger.js';

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  Vue: null,
  createApp: null,
  initialized: false
};

/**
 * Detecta y obtiene Vue del contexto global o lo importa
 */
async function ensureVue() {
  if (adapterState.initialized) return true;

  try {
    // Intentar obtener de window
    if (typeof window !== 'undefined' && window.Vue) {
      adapterState.Vue = window.Vue;
      adapterState.createApp = window.Vue.createApp;
      adapterState.initialized = true;
      return true;
    }

    // Intentar import dinámico
    const Vue = await import('vue');
    adapterState.Vue = Vue;
    adapterState.createApp = Vue.createApp;
    adapterState.initialized = true;
    return true;

  } catch (error) {
    console.error('[WuVue] Failed to load Vue:', error);
    return false;
  }
}

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
 * Registra un componente Vue como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend (debe coincidir con wu.json)
 * @param {Object} RootComponent - Componente Vue principal (App.vue)
 * @param {Object} options - Opciones adicionales
 * @param {Function} options.setup - Función para configurar la app Vue (plugins, router, etc.)
 * @param {Object} options.props - Props iniciales para el componente
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#app')
 *
 * @example
 * // Básico
 * wuVue.register('my-app', App);
 *
 * @example
 * // Con plugins (Pinia, Router, etc.)
 * wuVue.register('my-app', App, {
 *   setup: (app) => {
 *     app.use(createPinia());
 *     app.use(router);
 *     app.component('MyGlobal', MyComponent);
 *   }
 * });
 */
async function register(appName, RootComponent, options = {}) {
  const {
    setup = null,
    props = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  // Asegurar que Vue está disponible
  const hasVue = await ensureVue();
  if (!hasVue) {
    console.error(`[WuVue] Cannot register ${appName}: Vue not available`);
    return false;
  }

  const { createApp } = adapterState;

  // Función de mount interna
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuVue] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      logger.warn(`[WuVue] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Detectar si el container está dentro de un Shadow DOM
      let shadowRoot = null;
      let element = container;
      while (element && element !== document.body) {
        if (element.getRootNode && element.getRootNode() instanceof ShadowRoot) {
          shadowRoot = element.getRootNode();
          break;
        }
        element = element.parentElement || element.host;
      }

      // Crear la aplicación Vue
      const app = createApp(RootComponent, props);

      // Ejecutar setup personalizado (plugins, router, etc.)
      if (setup && typeof setup === 'function') {
        setup(app);
      }

      // Error handlers for debugging
      app.config.errorHandler = (err, instance, info) => {
        console.error(`[WuVue] ${appName} error in ${info}:`, err);
      };
      app.config.warnHandler = (msg, instance, trace) => {
        console.warn(`[WuVue] ${appName} warn:`, msg);
      };

      // Proveer información del contexto Wu
      app.provide('wuAppName', appName);
      app.provide('wuInstance', getWuInstance());

      // Montar
      app.mount(container);

      // Si está en Shadow DOM, copiar estilos de Vue al Shadow DOM
      if (shadowRoot) {
        // Esperar un poco para que Vue inyecte los estilos en el head
        setTimeout(() => {
          const vueStyles = document.querySelectorAll('style[data-vite-dev-id*="/' + appName + '/"], style[data-vite-dev-id*="\\' + appName + '\\"]');
          vueStyles.forEach(style => {
            // Verificar que no esté ya en el Shadow DOM
            const viteId = style.getAttribute('data-vite-dev-id');
            if (viteId && !shadowRoot.querySelector(`style[data-vite-dev-id="${viteId}"]`)) {
              const clonedStyle = style.cloneNode(true);
              shadowRoot.insertBefore(clonedStyle, shadowRoot.firstChild);
              logger.debug(`[WuVue] ✅ Injected style into Shadow DOM: ${viteId}`);
            }
          });

          // También copiar estilos que contengan rutas del app en el viteId
          const allStyles = document.querySelectorAll('style[data-vite-dev-id]');
          allStyles.forEach(style => {
            const viteId = style.getAttribute('data-vite-dev-id');
            if (viteId && (viteId.includes(`/${appName}/`) || viteId.includes(`\\${appName}\\`))) {
              if (!shadowRoot.querySelector(`style[data-vite-dev-id="${viteId}"]`)) {
                const clonedStyle = style.cloneNode(true);
                shadowRoot.insertBefore(clonedStyle, shadowRoot.firstChild);
                logger.debug(`[WuVue] ✅ Injected app style into Shadow DOM: ${viteId}`);
              }
            }
          });
        }, 100);
      }

      // Guardar referencia
      adapterState.apps.set(appName, { app, container });

      logger.debug(`[WuVue] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container, app);
      }
    } catch (error) {
      console.error(`[WuVue] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount interna
  const unmountApp = (container) => {
    const instance = adapterState.apps.get(appName);

    if (instance) {
      try {
        if (onUnmount) {
          onUnmount(instance.container, instance.app);
        }

        instance.app.unmount();
        adapterState.apps.delete(appName);

        logger.debug(`[WuVue] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuVue] Unmount error for ${appName}:`, error);
      }
    }

    // Limpiar container si se proporciona
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

    logger.debug(`[WuVue] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    logger.warn(`[WuVue] Wu Framework not available for ${appName}`);

    // Modo standalone si está habilitado
    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        logger.debug(`[WuVue] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      } else {
        logger.warn(`[WuVue] Standalone container ${standaloneContainer} not found`);
      }
    }

    return false;
  }
}

/**
 * Crea un componente Vue para cargar microfrontends (para el Shell)
 *
 * @example
 * <script setup>
 * import { WuSlot } from 'wu-framework/adapters/vue';
 * </script>
 *
 * <template>
 *   <WuSlot name="my-app" url="http://localhost:3001" />
 * </template>
 */
const WuSlot = {
  name: 'WuSlot',

  props: {
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    appName: {
      type: String,
      default: null
    },
    fallbackText: {
      type: String,
      default: 'Loading...'
    }
  },

  emits: ['load', 'error', 'mount', 'unmount'],

  data() {
    return {
      loading: true,
      error: null,
      appInstance: null,
      containerId: null
    };
  },

  computed: {
    actualAppName() {
      return this.appName || this.name;
    }
  },

  async mounted() {
    await this.mountMicrofrontend();
  },

  beforeUnmount() {
    this.unmountMicrofrontend();
  },

  methods: {
    async mountMicrofrontend() {
      try {
        this.loading = true;
        this.error = null;

        const wu = getWuInstance();
        if (!wu) {
          throw new Error('Wu Framework not initialized');
        }

        // Crear container único
        this.containerId = `wu-slot-${this.actualAppName}-${Date.now()}`;
        const innerContainer = document.createElement('div');
        innerContainer.id = this.containerId;
        innerContainer.style.width = '100%';
        innerContainer.style.height = '100%';

        this.$refs.container.innerHTML = '';
        this.$refs.container.appendChild(innerContainer);

        // Crear y montar la app
        const app = wu.app(this.actualAppName, {
          url: this.url,
          container: `#${this.containerId}`,
          autoInit: true
        });

        this.appInstance = app;
        await app.mount();

        this.loading = false;
        this.$emit('load', { name: this.actualAppName, url: this.url });
        this.$emit('mount', { name: this.actualAppName, container: innerContainer });

      } catch (err) {
        console.error(`[WuSlot] Error loading ${this.actualAppName}:`, err);
        this.error = err.message || 'Failed to load microfrontend';
        this.loading = false;
        this.$emit('error', err);
      }
    },

    async unmountMicrofrontend() {
      if (this.appInstance) {
        this.$emit('unmount', { name: this.actualAppName });

        try {
          await this.appInstance.unmount();
        } catch (err) {
          logger.warn(`[WuSlot] Error unmounting ${this.actualAppName}:`, err);
        }

        this.appInstance = null;
      }
    }
  },

  template: `
    <div
      ref="container"
      class="wu-slot"
      :class="{ 'wu-slot-loading': loading, 'wu-slot-error': error }"
      :data-wu-app="actualAppName"
      :data-wu-url="url"
      style="min-height: 100px; position: relative;"
    >
      <div v-if="error" class="wu-slot-error-message" style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
        <strong>Error loading {{ name }}</strong>
        <p style="margin: 0.5rem 0 0 0;">{{ error }}</p>
      </div>
      <div v-else-if="loading" class="wu-slot-loading-message" style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
        {{ fallbackText || 'Loading ' + name + '...' }}
      </div>
    </div>
  `
};

/**
 * Composable para usar el EventBus de Wu Framework en Vue 3
 *
 * @example
 * <script setup>
 * import { useWuEvents } from 'wu-framework/adapters/vue';
 *
 * const { emit, on } = useWuEvents();
 *
 * onMounted(() => {
 *   on('user:login', (data) => logger.debug(data));
 * });
 * </script>
 */
function useWuEvents() {
  const subscriptions = [];

  const emit = (event, data, options) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      wu.eventBus.emit(event, data, options);
    } else {
      logger.warn('[useWuEvents] Wu Framework not available');
    }
  };

  const on = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      const unsubscribe = wu.eventBus.on(event, callback);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    }
    logger.warn('[useWuEvents] Wu Framework not available');
    return () => {};
  };

  const once = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      return wu.eventBus.once(event, callback);
    }
    logger.warn('[useWuEvents] Wu Framework not available');
    return () => {};
  };

  const off = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      wu.eventBus.off(event, callback);
    }
  };

  // Cleanup - llamar en onUnmounted
  const cleanup = () => {
    subscriptions.forEach(unsub => unsub());
    subscriptions.length = 0;
  };

  return { emit, on, once, off, cleanup };
}

/**
 * Composable para usar el Store de Wu Framework en Vue 3
 *
 * @example
 * <script setup>
 * import { useWuStore } from 'wu-framework/adapters/vue';
 *
 * const { state, setState, getState } = useWuStore('user');
 *
 * // state es reactivo!
 * logger.debug(state.value);
 * </script>
 */
function useWuStore(namespace = '') {
  // Importar ref y watch de Vue si están disponibles
  const Vue = adapterState.Vue;
  let state;
  let unsubscribe = null;

  // Crear estado reactivo si Vue está disponible
  if (Vue?.ref) {
    const wu = getWuInstance();
    const initialValue = wu?.store?.get(namespace) || null;
    state = Vue.ref(initialValue);

    // Suscribirse a cambios
    if (wu?.store) {
      const pattern = namespace ? `${namespace}.*` : '*';
      unsubscribe = wu.store.on(pattern, () => {
        state.value = wu.store.get(namespace);
      });
    }
  } else {
    // Fallback sin reactividad
    state = { value: null };
  }

  const setState = (path, value) => {
    const wu = getWuInstance();
    if (wu?.store) {
      const fullPath = namespace ? `${namespace}.${path}` : path;
      wu.store.set(fullPath, value);
    }
  };

  const getState = (path = '') => {
    const wu = getWuInstance();
    if (wu?.store) {
      const fullPath = namespace ? (path ? `${namespace}.${path}` : namespace) : path;
      return wu.store.get(fullPath);
    }
    return null;
  };

  const cleanup = () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  return { state, setState, getState, cleanup };
}

/**
 * Plugin de Vue para instalar Wu Framework globalmente
 *
 * @example
 * import { createApp } from 'vue';
 * import { wuVuePlugin } from 'wu-framework/adapters/vue';
 *
 * const app = createApp(App);
 * app.use(wuVuePlugin);
 */
const wuVuePlugin = {
  install(app, options = {}) {
    // Registrar componente WuSlot globalmente
    app.component('WuSlot', WuSlot);

    // Proveer acceso global a Wu
    app.provide('wu', getWuInstance());

    // Agregar propiedades globales
    app.config.globalProperties.$wu = getWuInstance();
    app.config.globalProperties.$wuEvents = useWuEvents();
    app.config.globalProperties.$wuStore = (ns) => useWuStore(ns);

    logger.debug('[WuVue] Plugin installed');
  }
};

// ============================================
// AI INTEGRATION
// ============================================
export { createUseWuAI, useWuAI } from './ai.js';
import { createUseWuAI, useWuAI } from './ai.js';

// API pública del adapter
export const wuVue = {
  register,
  WuSlot,
  useWuEvents,
  useWuStore,
  wuVuePlugin,
  createUseWuAI,
  useWuAI,
  getWuInstance,
  waitForWu
};

export default wuVue;
