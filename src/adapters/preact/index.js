/**
 * 🚀 WU-FRAMEWORK PREACT ADAPTER
 *
 * Simplifica la integración de Preact con Wu Framework.
 * Compatible con Preact 10+ y preact/compat para proyectos React migrados.
 *
 * @example
 * // Microfrontend (main.jsx)
 * import { wuPreact } from 'wu-framework/adapters/preact';
 * import App from './App';
 *
 * wuPreact.register('my-app', App);
 *
 * @example
 * // Shell (cargar microfrontend)
 * import { createWuSlot } from 'wu-framework/adapters/preact';
 * import { h } from 'preact';
 *
 * const WuSlot = createWuSlot(h);
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  preact: null,
  render: null,
  h: null,
  initialized: false
};

/**
 * Detecta y obtiene Preact del contexto global o lo importa
 */
async function ensurePreact() {
  if (adapterState.initialized) return true;

  try {
    // Intentar obtener de window
    if (typeof window !== 'undefined' && window.preact) {
      adapterState.preact = window.preact;
      adapterState.render = window.preact.render;
      adapterState.h = window.preact.h;
      adapterState.initialized = true;
      return true;
    }

    // Intentar import dinámico
    const preact = await import('preact');
    adapterState.preact = preact;
    adapterState.render = preact.render;
    adapterState.h = preact.h;
    adapterState.initialized = true;
    return true;

  } catch (error) {
    console.error('[WuPreact] Failed to load Preact:', error);
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
 * Registra un componente Preact como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {Function} Component - Componente Preact principal
 * @param {Object} options - Opciones adicionales
 * @param {Object} options.props - Props iniciales para el componente
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#app')
 *
 * @example
 * // Básico
 * wuPreact.register('my-app', App);
 *
 * @example
 * // Con props
 * wuPreact.register('my-app', App, {
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
    standaloneContainer = '#app'
  } = options;

  // Asegurar que Preact está disponible
  const hasPreact = await ensurePreact();
  if (!hasPreact) {
    console.error(`[WuPreact] Cannot register ${appName}: Preact not available`);
    return false;
  }

  const { render, h } = adapterState;

  // Función de mount interna
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuPreact] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuPreact] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Limpiar container
      container.innerHTML = '';

      // Renderizar componente
      render(
        h(Component, {
          ...props,
          wuAppName: appName,
          wuInstance: getWuInstance()
        }),
        container
      );

      // Guardar referencia
      adapterState.apps.set(appName, { container, Component });

      console.log(`[WuPreact] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container);
      }
    } catch (error) {
      console.error(`[WuPreact] Mount error for ${appName}:`, error);
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

        // Unmount en Preact: renderizar null
        render(null, appData.container);

        adapterState.apps.delete(appName);

        console.log(`[WuPreact] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuPreact] Unmount error for ${appName}:`, error);
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

    console.log(`[WuPreact] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuPreact] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuPreact] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Registra usando preact/compat (para proyectos migrados de React)
 *
 * @example
 * import { wuPreact } from 'wu-framework/adapters/preact';
 * import App from './App'; // Componente React-like
 *
 * wuPreact.registerCompat('my-app', App);
 */
async function registerCompat(appName, Component, options = {}) {
  const {
    props = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  let render, h;

  try {
    // Intentar cargar preact/compat
    const compat = await import('preact/compat');
    render = compat.render;
    h = compat.createElement;
  } catch (e) {
    console.error('[WuPreact] preact/compat not available');
    // Fallback a registro normal
    return register(appName, Component, options);
  }

  const mountApp = (container) => {
    if (!container) return;

    if (adapterState.apps.has(appName)) {
      unmountApp();
    }

    try {
      container.innerHTML = '';

      render(
        h(Component, {
          ...props,
          wuAppName: appName,
          wuInstance: getWuInstance()
        }),
        container
      );

      adapterState.apps.set(appName, { container, Component, isCompat: true });

      console.log(`[WuPreact] ✅ ${appName} (compat) mounted successfully`);

      if (onMount) onMount(container);
    } catch (error) {
      console.error(`[WuPreact] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) onUnmount(appData.container);
        render(null, appData.container);
        adapterState.apps.delete(appName);
        console.log(`[WuPreact] ✅ ${appName} (compat) unmounted successfully`);
      } catch (error) {
        console.error(`[WuPreact] Unmount error for ${appName}:`, error);
      }
    }

    if (container) container.innerHTML = '';
  };

  try {
    const wu = await waitForWu(3000);
    wu.define(appName, { mount: mountApp, unmount: unmountApp });
    console.log(`[WuPreact] ✅ ${appName} (compat) registered with Wu Framework`);
    return true;
  } catch (error) {
    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);
      if (containerElement) {
        mountApp(containerElement);
        return true;
      }
    }
    return false;
  }
}

/**
 * Crea un componente WuSlot para Preact
 *
 * @param {Function} h - Función h de Preact
 * @returns {Function} Componente WuSlot
 *
 * @example
 * import { h } from 'preact';
 * import { createWuSlot } from 'wu-framework/adapters/preact';
 *
 * const WuSlot = createWuSlot(h);
 *
 * function Shell() {
 *   return (
 *     <div>
 *       <WuSlot name="header" url="http://localhost:3001" />
 *     </div>
 *   );
 * }
 */
function createWuSlot(h) {
  // Importar hooks de Preact
  let useState, useEffect, useRef, useCallback;

  try {
    const hooks = require('preact/hooks');
    useState = hooks.useState;
    useEffect = hooks.useEffect;
    useRef = hooks.useRef;
    useCallback = hooks.useCallback;
  } catch (e) {
    // Si no hay hooks, crear versión sin hooks
    return function WuSlotBasic(props) {
      const { name, url } = props;
      return h('div', {
        class: 'wu-slot',
        'data-wu-app': name,
        'data-wu-url': url,
        style: 'min-height: 100px;',
        ref: (el) => {
          if (el && !el._mounted) {
            el._mounted = true;
            mountSlot(el, name, url);
          }
        }
      }, `Loading ${name}...`);
    };
  }

  return function WuSlot(props) {
    const {
      name,
      url,
      appName = null,
      fallback = null,
      onLoad = null,
      onError = null,
      className = '',
      style = {}
    } = props;

    const containerRef = useRef(null);
    const appInstanceRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const actualAppName = appName || name;

    const mountMicrofrontend = useCallback(async () => {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        const wu = getWuInstance();
        if (!wu) throw new Error('Wu Framework not initialized');

        const containerId = `wu-slot-${actualAppName}-${Date.now()}`;
        const innerContainer = document.createElement('div');
        innerContainer.id = containerId;
        innerContainer.style.cssText = 'width: 100%; height: 100%;';

        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(innerContainer);

        const app = wu.app(actualAppName, {
          url,
          container: `#${containerId}`,
          autoInit: true
        });

        appInstanceRef.current = app;
        await app.mount();

        setLoading(false);
        if (onLoad) onLoad({ name: actualAppName, url });

      } catch (err) {
        console.error(`[WuSlot] Error loading ${actualAppName}:`, err);
        setError(err.message || 'Failed to load microfrontend');
        setLoading(false);
        if (onError) onError(err);
      }
    }, [actualAppName, url, onLoad, onError]);

    useEffect(() => {
      mountMicrofrontend();

      return () => {
        if (appInstanceRef.current) {
          appInstanceRef.current.unmount().catch(console.warn);
          appInstanceRef.current = null;
        }
      };
    }, [mountMicrofrontend]);

    if (error) {
      return h('div', {
        class: `wu-slot wu-slot-error ${className}`,
        style: {
          padding: '1rem',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          ...style
        }
      }, [
        h('strong', null, `Error loading ${name}`),
        h('p', { style: { margin: '0.5rem 0 0 0' } }, error)
      ]);
    }

    return h('div', {
      ref: containerRef,
      class: `wu-slot ${loading ? 'wu-slot-loading' : 'wu-slot-loaded'} ${className}`,
      style: {
        minHeight: '100px',
        position: 'relative',
        ...style
      },
      'data-wu-app': actualAppName,
      'data-wu-url': url
    }, loading && (fallback || h('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        color: '#666'
      }
    }, `Loading ${name}...`)));
  };
}

/**
 * Hook para usar el EventBus de Wu Framework en Preact
 *
 * @example
 * import { createUseWuEvents } from 'wu-framework/adapters/preact';
 * import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
 *
 * const useWuEvents = createUseWuEvents({ useCallback, useEffect, useRef });
 *
 * function MyComponent() {
 *   const { emit, on } = useWuEvents();
 *
 *   useEffect(() => {
 *     return on('user:login', (data) => console.log(data));
 *   }, [on]);
 * }
 */
function createUseWuEvents(hooks) {
  const { useCallback, useEffect, useRef } = hooks;

  return function useWuEvents() {
    const subscriptionsRef = useRef([]);

    const emit = useCallback((event, data, options) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        wu.eventBus.emit(event, data, options);
      }
    }, []);

    const on = useCallback((event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        const unsubscribe = wu.eventBus.on(event, callback);
        subscriptionsRef.current.push(unsubscribe);
        return unsubscribe;
      }
      return () => {};
    }, []);

    const once = useCallback((event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        return wu.eventBus.once(event, callback);
      }
      return () => {};
    }, []);

    useEffect(() => {
      return () => {
        subscriptionsRef.current.forEach(unsub => unsub());
        subscriptionsRef.current = [];
      };
    }, []);

    return { emit, on, once };
  };
}

/**
 * Hook para usar el Store de Wu Framework en Preact
 *
 * @example
 * const useWuStore = createUseWuStore({ useState, useCallback, useEffect });
 *
 * function MyComponent() {
 *   const { state, setState, getState } = useWuStore('user');
 *   // ...
 * }
 */
function createUseWuStore(hooks) {
  const { useState, useCallback, useEffect } = hooks;

  return function useWuStore(namespace = '') {
    const [state, setLocalState] = useState(() => {
      const wu = getWuInstance();
      return wu?.store?.get(namespace) || null;
    });

    const setState = useCallback((path, value) => {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? `${namespace}.${path}` : path;
        wu.store.set(fullPath, value);
      }
    }, [namespace]);

    const getState = useCallback((path = '') => {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? (path ? `${namespace}.${path}` : namespace) : path;
        return wu.store.get(fullPath);
      }
      return null;
    }, [namespace]);

    useEffect(() => {
      const wu = getWuInstance();
      if (!wu?.store) return;

      const pattern = namespace ? `${namespace}.*` : '*';
      const unsubscribe = wu.store.on(pattern, () => {
        setLocalState(wu.store.get(namespace));
      });

      return unsubscribe;
    }, [namespace]);

    return { state, setState, getState };
  };
}

// Helper interno para montar slot sin hooks
async function mountSlot(container, name, url) {
  try {
    const wu = getWuInstance();
    if (!wu) return;

    const containerId = `wu-slot-${name}-${Date.now()}`;
    const innerContainer = document.createElement('div');
    innerContainer.id = containerId;
    innerContainer.style.cssText = 'width: 100%; height: 100%;';

    container.innerHTML = '';
    container.appendChild(innerContainer);

    const app = wu.app(name, {
      url,
      container: `#${containerId}`,
      autoInit: true
    });

    await app.mount();
  } catch (err) {
    container.innerHTML = `<div style="color: red;">Error: ${err.message}</div>`;
  }
}

// ============================================
// AI INTEGRATION
// ============================================
export { createUseWuAI } from './ai.js';
import { createUseWuAI } from './ai.js';

// API pública del adapter
export const wuPreact = {
  register,
  registerCompat,
  createWuSlot,
  createUseWuEvents,
  createUseWuStore,
  createUseWuAI,
  getWuInstance,
  waitForWu
};

export default wuPreact;
