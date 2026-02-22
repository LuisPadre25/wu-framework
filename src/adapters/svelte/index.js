/**
 * 🚀 WU-FRAMEWORK SVELTE ADAPTER
 *
 * Simplifica la integración de Svelte con Wu Framework.
 * Convierte componentes Svelte en microfrontends con UNA línea de código.
 *
 * @example
 * // Microfrontend (main.js)
 * import { wuSvelte } from 'wu-framework/adapters/svelte';
 * import App from './App.svelte';
 *
 * wuSvelte.register('my-app', App);
 *
 * @example
 * // Shell (cargar microfrontend)
 * import WuSlot from 'wu-framework/adapters/svelte/WuSlot.svelte';
 *
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */

// Estado global del adapter
const adapterState = {
  apps: new Map(),
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
 * Registra un componente Svelte como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend (debe coincidir con wu.json)
 * @param {typeof SvelteComponent} Component - Componente Svelte principal (App.svelte)
 * @param {Object} options - Opciones adicionales
 * @param {Object} options.props - Props iniciales para el componente
 * @param {Object} options.context - Contexto a pasar al componente
 * @param {boolean} options.intro - Ejecutar transiciones de intro (default: false)
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#app')
 *
 * @example
 * // Básico
 * wuSvelte.register('my-app', App);
 *
 * @example
 * // Con props y context
 * wuSvelte.register('my-app', App, {
 *   props: { apiUrl: 'https://api.example.com' },
 *   context: new Map([['theme', 'dark']]),
 *   onMount: (container) => console.log('Mounted!')
 * });
 */
async function register(appName, Component, options = {}) {
  const {
    props = {},
    context = new Map(),
    intro = false,
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  // Función de mount interna
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuSvelte] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuSvelte] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Limpiar container
      container.innerHTML = '';

      // Crear instancia del componente Svelte
      const instance = new Component({
        target: container,
        props: {
          ...props,
          // Inyectar información de Wu
          wuAppName: appName,
          wuInstance: getWuInstance()
        },
        context,
        intro
      });

      // Guardar referencia
      adapterState.apps.set(appName, {
        instance,
        container,
        Component
      });

      console.log(`[WuSvelte] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container, instance);
      }
    } catch (error) {
      console.error(`[WuSvelte] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount interna
  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container, appData.instance);
        }

        // Destruir instancia de Svelte
        appData.instance.$destroy();
        adapterState.apps.delete(appName);

        console.log(`[WuSvelte] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuSvelte] Unmount error for ${appName}:`, error);
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

    console.log(`[WuSvelte] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuSvelte] Wu Framework not available for ${appName}`);

    // Modo standalone si está habilitado
    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuSvelte] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      } else {
        console.warn(`[WuSvelte] Standalone container ${standaloneContainer} not found`);
      }
    }

    return false;
  }
}

/**
 * Registra un componente Svelte 5 con runes como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {typeof SvelteComponent} Component - Componente Svelte 5
 * @param {Object} options - Opciones adicionales
 *
 * @example
 * // Svelte 5 con mount API
 * import { wuSvelte } from 'wu-framework/adapters/svelte';
 * import App from './App.svelte';
 *
 * wuSvelte.registerSvelte5('my-app', App);
 */
async function registerSvelte5(appName, Component, options = {}) {
  const {
    props = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  // Función de mount para Svelte 5
  const mountApp = async (container) => {
    if (!container) {
      console.error(`[WuSvelte5] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuSvelte5] ${appName} already mounted, unmounting first`);
      await unmountApp();
    }

    try {
      container.innerHTML = '';

      // Svelte 5 usa mount() del módulo svelte
      let mountFn;
      try {
        const svelte = await import('svelte');
        mountFn = svelte.mount;
      } catch (e) {
        // Fallback a API legacy
        console.warn('[WuSvelte5] Svelte 5 mount not available, using legacy API');
        return register(appName, Component, options);
      }

      // Montar con Svelte 5 API
      const instance = mountFn(Component, {
        target: container,
        props: {
          ...props,
          wuAppName: appName,
          wuInstance: getWuInstance()
        }
      });

      adapterState.apps.set(appName, {
        instance,
        container,
        Component,
        isSvelte5: true
      });

      console.log(`[WuSvelte5] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container, instance);
      }
    } catch (error) {
      console.error(`[WuSvelte5] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount para Svelte 5
  const unmountApp = async (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container, appData.instance);
        }

        // Svelte 5 usa unmount()
        if (appData.isSvelte5) {
          try {
            const svelte = await import('svelte');
            if (svelte.unmount) {
              svelte.unmount(appData.instance);
            }
          } catch (e) {
            // Fallback
            if (appData.instance.$destroy) {
              appData.instance.$destroy();
            }
          }
        } else {
          appData.instance.$destroy();
        }

        adapterState.apps.delete(appName);
        console.log(`[WuSvelte5] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuSvelte5] Unmount error for ${appName}:`, error);
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

    console.log(`[WuSvelte5] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuSvelte5] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuSvelte5] Running ${appName} in standalone mode`);
        await mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Store reactivo para usar con Svelte
 * Compatible con la sintaxis $store de Svelte
 *
 * @param {string} namespace - Namespace en el store de Wu
 * @returns {Object} Store compatible con Svelte
 *
 * @example
 * <script>
 *   import { createWuStore } from 'wu-framework/adapters/svelte';
 *
 *   const userStore = createWuStore('user');
 *
 *   // Usar con sintaxis reactiva
 *   $: userName = $userStore?.name;
 *
 *   function updateName(name) {
 *     userStore.set('name', name);
 *   }
 * </script>
 */
function createWuStore(namespace = '') {
  const subscribers = new Set();
  let currentValue = null;
  let unsubscribeWu = null;

  // Obtener valor inicial
  const wu = getWuInstance();
  if (wu?.store) {
    currentValue = wu.store.get(namespace);

    // Suscribirse a cambios en Wu Store
    const pattern = namespace ? `${namespace}.*` : '*';
    unsubscribeWu = wu.store.on(pattern, () => {
      currentValue = wu.store.get(namespace);
      subscribers.forEach(fn => fn(currentValue));
    });
  }

  return {
    // Svelte store contract
    subscribe(fn) {
      subscribers.add(fn);
      fn(currentValue);

      return () => {
        subscribers.delete(fn);
        // Limpiar suscripción a Wu si no hay más subscribers
        if (subscribers.size === 0 && unsubscribeWu) {
          unsubscribeWu();
          unsubscribeWu = null;
        }
      };
    },

    // Métodos adicionales
    set(path, value) {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? `${namespace}.${path}` : path;
        wu.store.set(fullPath, value);
      }
    },

    get(path = '') {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? (path ? `${namespace}.${path}` : namespace) : path;
        return wu.store.get(fullPath);
      }
      return null;
    },

    update(fn) {
      const newValue = fn(currentValue);
      const wu = getWuInstance();
      if (wu?.store && namespace) {
        wu.store.set(namespace, newValue);
      }
    }
  };
}

/**
 * Store para eventos de Wu Framework
 * Permite usar eventos de forma reactiva en Svelte
 *
 * @example
 * <script>
 *   import { createWuEventStore } from 'wu-framework/adapters/svelte';
 *
 *   const userEvents = createWuEventStore('user:*');
 *
 *   $: if ($userEvents) {
 *     console.log('User event:', $userEvents);
 *   }
 * </script>
 */
function createWuEventStore(eventPattern) {
  const subscribers = new Set();
  let lastEvent = null;
  let unsubscribeWu = null;

  const wu = getWuInstance();
  if (wu?.eventBus) {
    unsubscribeWu = wu.eventBus.on(eventPattern, (event) => {
      lastEvent = event;
      subscribers.forEach(fn => fn(lastEvent));
    });
  }

  return {
    subscribe(fn) {
      subscribers.add(fn);
      fn(lastEvent);

      return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0 && unsubscribeWu) {
          unsubscribeWu();
          unsubscribeWu = null;
        }
      };
    },

    emit(data, options) {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        // Extraer nombre del evento del patrón (sin wildcard)
        const eventName = eventPattern.replace('*', 'custom');
        wu.eventBus.emit(eventName, data, options);
      }
    }
  };
}

/**
 * Helper para usar el EventBus de Wu en Svelte
 *
 * @example
 * <script>
 *   import { useWuEvents } from 'wu-framework/adapters/svelte';
 *   import { onDestroy } from 'svelte';
 *
 *   const { emit, on, cleanup } = useWuEvents();
 *
 *   on('user:login', (data) => {
 *     console.log('User logged in:', data);
 *   });
 *
 *   onDestroy(cleanup);
 * </script>
 */
function useWuEvents() {
  const subscriptions = [];

  const emit = (event, data, options) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      wu.eventBus.emit(event, data, options);
    } else {
      console.warn('[useWuEvents] Wu Framework not available');
    }
  };

  const on = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      const unsubscribe = wu.eventBus.on(event, callback);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    }
    console.warn('[useWuEvents] Wu Framework not available');
    return () => {};
  };

  const once = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      return wu.eventBus.once(event, callback);
    }
    return () => {};
  };

  const off = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      wu.eventBus.off(event, callback);
    }
  };

  const cleanup = () => {
    subscriptions.forEach(unsub => unsub());
    subscriptions.length = 0;
  };

  return { emit, on, once, off, cleanup };
}

/**
 * Crea la configuración para un componente WuSlot en Svelte
 * Retorna el código del componente que se puede usar como referencia
 *
 * @example
 * // WuSlot.svelte - Crear manualmente basado en esta configuración
 * const config = createWuSlotConfig();
 * // Usar config.template como base para el componente
 */
function createWuSlotConfig() {
  return {
    props: ['name', 'url', 'appName', 'fallbackText'],

    template: `
<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getWuInstance } from 'wu-framework/adapters/svelte';

  export let name;
  export let url;
  export let appName = null;
  export let fallbackText = null;

  const dispatch = createEventDispatcher();

  let container;
  let loading = true;
  let error = null;
  let appInstance = null;

  $: actualAppName = appName || name;

  onMount(async () => {
    await mountMicrofrontend();
  });

  onDestroy(() => {
    unmountMicrofrontend();
  });

  async function mountMicrofrontend() {
    try {
      loading = true;
      error = null;

      const wu = getWuInstance();
      if (!wu) {
        throw new Error('Wu Framework not initialized');
      }

      const containerId = \`wu-slot-\${actualAppName}-\${Date.now()}\`;
      const innerContainer = document.createElement('div');
      innerContainer.id = containerId;
      innerContainer.style.width = '100%';
      innerContainer.style.height = '100%';

      container.innerHTML = '';
      container.appendChild(innerContainer);

      const app = wu.app(actualAppName, {
        url,
        container: \`#\${containerId}\`,
        autoInit: true
      });

      appInstance = app;
      await app.mount();

      loading = false;
      dispatch('load', { name: actualAppName, url });
      dispatch('mount', { name: actualAppName, container: innerContainer });

    } catch (err) {
      console.error(\`[WuSlot] Error loading \${actualAppName}:\`, err);
      error = err.message || 'Failed to load microfrontend';
      loading = false;
      dispatch('error', err);
    }
  }

  async function unmountMicrofrontend() {
    if (appInstance) {
      dispatch('unmount', { name: actualAppName });

      try {
        await appInstance.unmount();
      } catch (err) {
        console.warn(\`[WuSlot] Error unmounting \${actualAppName}:\`, err);
      }

      appInstance = null;
    }
  }
</script>

<div
  bind:this={container}
  class="wu-slot"
  class:wu-slot-loading={loading}
  class:wu-slot-error={error}
  data-wu-app={actualAppName}
  data-wu-url={url}
  style="min-height: 100px; position: relative;">

  {#if error}
    <div class="wu-slot-error-message"
         style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
      <strong>Error loading {name}</strong>
      <p style="margin: 0.5rem 0 0 0;">{error}</p>
    </div>
  {:else if loading}
    <div class="wu-slot-loading-message"
         style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
      {fallbackText || \`Loading \${name}...\`}
    </div>
  {/if}
</div>

<style>
  .wu-slot {
    width: 100%;
    min-height: 100px;
  }
</style>
    `.trim(),

    // Implementación JavaScript pura para usar sin .svelte
    createInstance: (target, props) => {
      let container = document.createElement('div');
      container.className = 'wu-slot';
      container.style.minHeight = '100px';
      container.style.position = 'relative';
      target.appendChild(container);

      let loading = true;
      let error = null;
      let appInstance = null;

      const actualAppName = props.appName || props.name;

      const updateUI = () => {
        if (error) {
          container.innerHTML = `
            <div style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
              <strong>Error loading ${props.name}</strong>
              <p style="margin: 0.5rem 0 0 0;">${error}</p>
            </div>
          `;
        } else if (loading) {
          container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
              ${props.fallbackText || `Loading ${props.name}...`}
            </div>
          `;
        }
      };

      const mount = async () => {
        try {
          updateUI();

          const wu = getWuInstance();
          if (!wu) throw new Error('Wu Framework not initialized');

          const containerId = `wu-slot-${actualAppName}-${Date.now()}`;
          const innerContainer = document.createElement('div');
          innerContainer.id = containerId;
          innerContainer.style.cssText = 'width: 100%; height: 100%;';

          container.innerHTML = '';
          container.appendChild(innerContainer);

          const app = wu.app(actualAppName, {
            url: props.url,
            container: `#${containerId}`,
            autoInit: true
          });

          appInstance = app;
          await app.mount();

          loading = false;
          if (props.onLoad) props.onLoad({ name: actualAppName, url: props.url });

        } catch (err) {
          error = err.message;
          loading = false;
          updateUI();
          if (props.onError) props.onError(err);
        }
      };

      const destroy = async () => {
        if (appInstance) {
          try {
            await appInstance.unmount();
          } catch (e) {}
          appInstance = null;
        }
        container.remove();
      };

      mount();

      return { destroy };
    }
  };
}

// ============================================
// AI INTEGRATION
// ============================================
export { createWuAIStore } from './ai.js';
import { createWuAIStore } from './ai.js';

// API pública del adapter
export const wuSvelte = {
  register,
  registerSvelte5,
  createWuStore,
  createWuEventStore,
  useWuEvents,
  createWuSlotConfig,
  createWuAIStore,
  getWuInstance,
  waitForWu
};

export default wuSvelte;
