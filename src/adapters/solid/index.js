/**
 * 🚀 WU-FRAMEWORK SOLID.JS ADAPTER
 *
 * Simplifica la integración de Solid.js con Wu Framework.
 * Aprovecha la reactividad fine-grained de Solid para microfrontends eficientes.
 *
 * @example
 * // Microfrontend (main.jsx)
 * import { wuSolid } from 'wu-framework/adapters/solid';
 * import App from './App';
 *
 * wuSolid.register('my-app', App);
 *
 * @example
 * // Shell (cargar microfrontend)
 * import { WuSlot } from 'wu-framework/adapters/solid';
 *
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  solid: null,
  solidWeb: null,
  initialized: false
};

/**
 * Detecta y obtiene Solid del contexto global o lo importa
 */
async function ensureSolid() {
  if (adapterState.initialized) return true;

  try {
    // Intentar obtener de window
    if (typeof window !== 'undefined' && window.Solid) {
      adapterState.solid = window.Solid;
      adapterState.solidWeb = window.SolidWeb;
      adapterState.initialized = true;
      return true;
    }

    // Intentar import dinámico
    const [solid, solidWeb] = await Promise.all([
      import('solid-js'),
      import('solid-js/web')
    ]);

    adapterState.solid = solid;
    adapterState.solidWeb = solidWeb;
    adapterState.initialized = true;
    return true;

  } catch (error) {
    console.error('[WuSolid] Failed to load Solid:', error);
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
 * Registra un componente Solid como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {Function} Component - Componente Solid principal
 * @param {Object} options - Opciones adicionales
 * @param {Object} options.props - Props iniciales para el componente
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#root')
 *
 * @example
 * // Básico
 * wuSolid.register('my-app', App);
 *
 * @example
 * // Con props
 * wuSolid.register('my-app', App, {
 *   props: { apiUrl: 'https://api.example.com' },
 *   onMount: (container) => console.log('Mounted!')
 * });
 */
async function register(appName, Component, options = {}) {
  const {
    props = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root'
  } = options;

  // Asegurar que Solid está disponible
  const hasSolid = await ensureSolid();
  if (!hasSolid) {
    console.error(`[WuSolid] Cannot register ${appName}: Solid not available`);
    return false;
  }

  const { render } = adapterState.solidWeb;

  let disposeApp = null;

  // Función de mount interna
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuSolid] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuSolid] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Limpiar container
      container.innerHTML = '';

      // Renderizar componente Solid
      // render() retorna una función dispose
      disposeApp = render(
        () => Component({
          ...props,
          wuAppName: appName,
          wuInstance: getWuInstance()
        }),
        container
      );

      // Guardar referencia
      adapterState.apps.set(appName, {
        container,
        Component,
        dispose: disposeApp
      });

      console.log(`[WuSolid] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container);
      }
    } catch (error) {
      console.error(`[WuSolid] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount interna
  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container);
        }

        // Dispose de Solid (limpia todas las reactividades)
        if (appData.dispose && typeof appData.dispose === 'function') {
          appData.dispose();
        }

        // Limpiar DOM
        appData.container.innerHTML = '';

        adapterState.apps.delete(appName);

        console.log(`[WuSolid] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuSolid] Unmount error for ${appName}:`, error);
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

    console.log(`[WuSolid] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuSolid] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuSolid] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Crea un componente WuSlot para Solid
 *
 * @example
 * import { WuSlot } from 'wu-framework/adapters/solid';
 *
 * function Shell() {
 *   return (
 *     <div>
 *       <WuSlot name="header" url="http://localhost:3001" />
 *       <WuSlot name="content" url="http://localhost:3002" />
 *     </div>
 *   );
 * }
 */
function createWuSlot() {
  // Esta función debe ser llamada dentro del contexto de Solid
  return async function WuSlot(props) {
    const {
      name,
      url,
      appName = null,
      fallback = null,
      onLoad = null,
      onError = null,
      class: className = '',
      style = {}
    } = props;

    const { createSignal, onMount, onCleanup } = adapterState.solid;

    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal(null);

    let containerRef;
    let appInstance = null;

    const actualAppName = appName || name;

    onMount(async () => {
      try {
        const wu = getWuInstance();
        if (!wu) throw new Error('Wu Framework not initialized');

        const containerId = `wu-slot-${actualAppName}-${Date.now()}`;
        const innerContainer = document.createElement('div');
        innerContainer.id = containerId;
        innerContainer.style.cssText = 'width: 100%; height: 100%;';

        containerRef.innerHTML = '';
        containerRef.appendChild(innerContainer);

        const app = wu.app(actualAppName, {
          url,
          container: `#${containerId}`,
          autoInit: true
        });

        appInstance = app;
        await app.mount();

        setLoading(false);
        if (onLoad) onLoad({ name: actualAppName, url });

      } catch (err) {
        console.error(`[WuSlot] Error loading ${actualAppName}:`, err);
        setError(err.message || 'Failed to load microfrontend');
        setLoading(false);
        if (onError) onError(err);
      }
    });

    onCleanup(async () => {
      if (appInstance) {
        try {
          await appInstance.unmount();
        } catch (e) {}
        appInstance = null;
      }
    });

    // Retornar JSX de Solid
    return (() => {
      const el = document.createElement('div');
      el.className = `wu-slot ${loading() ? 'wu-slot-loading' : ''} ${error() ? 'wu-slot-error' : ''} ${className}`;
      el.style.cssText = 'min-height: 100px; position: relative;';
      el.setAttribute('data-wu-app', actualAppName);
      el.setAttribute('data-wu-url', url);

      Object.assign(el.style, style);

      containerRef = el;

      if (error()) {
        el.innerHTML = `
          <div style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
            <strong>Error loading ${name}</strong>
            <p style="margin: 0.5rem 0 0 0;">${error()}</p>
          </div>
        `;
      } else if (loading()) {
        el.innerHTML = fallback || `
          <div style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
            Loading ${name}...
          </div>
        `;
      }

      return el;
    })();
  };
}

/**
 * Crea un store de Wu compatible con la reactividad de Solid
 *
 * @param {string} namespace - Namespace en el store de Wu
 * @returns {Array} [state, setState] similar a createSignal
 *
 * @example
 * import { createWuStore } from 'wu-framework/adapters/solid';
 *
 * function MyComponent() {
 *   const [user, setUser] = createWuStore('user');
 *
 *   return (
 *     <div>
 *       <p>Name: {user()?.name}</p>
 *       <button onClick={() => setUser('name', 'John')}>
 *         Set Name
 *       </button>
 *     </div>
 *   );
 * }
 */
function createWuStore(namespace = '') {
  const { createSignal, onCleanup } = adapterState.solid;

  const wu = getWuInstance();
  const initialValue = wu?.store?.get(namespace) || null;

  const [state, setState] = createSignal(initialValue);

  // Suscribirse a cambios en Wu Store
  if (wu?.store) {
    const pattern = namespace ? `${namespace}.*` : '*';
    const unsubscribe = wu.store.on(pattern, () => {
      setState(wu.store.get(namespace));
    });

    onCleanup(unsubscribe);
  }

  // Función para actualizar el store
  const setWuState = (path, value) => {
    if (wu?.store) {
      const fullPath = namespace ? `${namespace}.${path}` : path;
      wu.store.set(fullPath, value);
    }
  };

  return [state, setWuState];
}

/**
 * Crea un signal reactivo basado en eventos de Wu
 *
 * @param {string} eventPattern - Patrón de eventos
 * @returns {Function} Signal con el último evento
 *
 * @example
 * import { createWuEvent } from 'wu-framework/adapters/solid';
 *
 * function MyComponent() {
 *   const lastUserEvent = createWuEvent('user:*');
 *
 *   return (
 *     <Show when={lastUserEvent()}>
 *       <p>Last event: {lastUserEvent()?.name}</p>
 *     </Show>
 *   );
 * }
 */
function createWuEvent(eventPattern) {
  const { createSignal, onCleanup } = adapterState.solid;

  const [event, setEvent] = createSignal(null);

  const wu = getWuInstance();
  if (wu?.eventBus) {
    const unsubscribe = wu.eventBus.on(eventPattern, (e) => {
      setEvent(e);
    });

    onCleanup(unsubscribe);
  }

  return event;
}

/**
 * Hook para usar el EventBus de Wu Framework en Solid
 *
 * @example
 * import { useWuEvents } from 'wu-framework/adapters/solid';
 *
 * function MyComponent() {
 *   const { emit, on } = useWuEvents();
 *
 *   onMount(() => {
 *     on('user:login', (data) => console.log('User logged in:', data));
 *   });
 *
 *   return (
 *     <button onClick={() => emit('user:logout', { reason: 'manual' })}>
 *       Logout
 *     </button>
 *   );
 * }
 */
function useWuEvents() {
  const { onCleanup } = adapterState.solid;
  const subscriptions = [];

  const emit = (event, data, options) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      wu.eventBus.emit(event, data, options);
    }
  };

  const on = (event, callback) => {
    const wu = getWuInstance();
    if (wu?.eventBus) {
      const unsubscribe = wu.eventBus.on(event, callback);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    }
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

  // Cleanup automático
  onCleanup(() => {
    subscriptions.forEach(unsub => unsub());
  });

  return { emit, on, once, off };
}

/**
 * Contexto de Wu para Solid
 * Permite acceder a Wu desde cualquier componente hijo
 *
 * @example
 * import { WuProvider, useWu } from 'wu-framework/adapters/solid';
 *
 * // En el root
 * <WuProvider>
 *   <App />
 * </WuProvider>
 *
 * // En cualquier componente hijo
 * function MyComponent() {
 *   const wu = useWu();
 *   // ...
 * }
 */
function createWuContext() {
  const { createContext, useContext } = adapterState.solid;

  const WuContext = createContext(null);

  function WuProvider(props) {
    const wu = getWuInstance();
    return WuContext.Provider({
      value: wu,
      children: props.children
    });
  }

  function useWu() {
    return useContext(WuContext) || getWuInstance();
  }

  return { WuProvider, useWu, WuContext };
}

// ============================================
// AI INTEGRATION
// ============================================
export { createUseWuAI } from './ai.js';
import { createUseWuAI } from './ai.js';

// API pública del adapter
export const wuSolid = {
  register,
  createWuSlot,
  createWuStore,
  createWuEvent,
  useWuEvents,
  createWuContext,
  createUseWuAI,
  getWuInstance,
  waitForWu
};

export default wuSolid;
