/**
 * 🚀 WU-FRAMEWORK REACT ADAPTER
 *
 * Simplifica la integración de React con Wu Framework.
 * Convierte componentes React en microfrontends con UNA línea de código.
 *
 * @example
 * // Microfrontend (main.tsx)
 * import { wuReact } from 'wu-framework/adapters/react';
 * import App from './App';
 *
 * wuReact.register('my-app', App);
 *
 * @example
 * // Shell (cargar microfrontend)
 * import { WuSlot } from 'wu-framework/adapters/react';
 *
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */

// Estado global del adapter
const adapterState = {
  roots: new Map(),
  React: null,
  ReactDOM: null,
  createRoot: null,
  initialized: false
};

/**
 * Detecta y obtiene React del contexto global o lo importa
 */
async function ensureReact() {
  if (adapterState.initialized) return true;

  try {
    // Intentar obtener de window (común en microfrontends)
    if (typeof window !== 'undefined' && window.React && window.ReactDOM) {
      adapterState.React = window.React;
      adapterState.ReactDOM = window.ReactDOM;

      // createRoot puede estar en window.ReactDOM (si importaron de react-dom/client)
      // o no existir (si importaron de react-dom). Intentar ambos caminos.
      if (window.ReactDOM.createRoot) {
        adapterState.createRoot = window.ReactDOM.createRoot;
      } else {
        // Fallback: importar react-dom/client para obtener createRoot
        try {
          const clientModule = await import('react-dom/client');
          adapterState.createRoot = (clientModule.default || clientModule).createRoot;
        } catch {
          console.error('[WuReact] createRoot not found. Expose window.ReactDOM from "react-dom/client", not "react-dom".');
          return false;
        }
      }

      adapterState.initialized = true;
      return true;
    }

    // Intentar import dinámico
    const [React, ReactDOMClient] = await Promise.all([
      import('react'),
      import('react-dom/client')
    ]);

    adapterState.React = React.default || React;
    adapterState.ReactDOM = ReactDOMClient.default || ReactDOMClient;
    adapterState.createRoot = (ReactDOMClient.default || ReactDOMClient).createRoot;
    adapterState.initialized = true;
    return true;

  } catch (error) {
    console.error('[WuReact] Failed to load React:', error);
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
 * Espera a que Wu Framework esté disponible (sin polling agresivo)
 */
function waitForWu(timeout = 5000) {
  return new Promise((resolve, reject) => {
    // Check inmediato
    const wu = getWuInstance();
    if (wu) {
      resolve(wu);
      return;
    }

    // Usar MutationObserver + evento en lugar de polling
    const startTime = Date.now();

    // Escuchar evento de Wu Framework
    const handleWuReady = (event) => {
      cleanup();
      resolve(getWuInstance());
    };

    window.addEventListener('wu:ready', handleWuReady);
    window.addEventListener('wu:app:ready', handleWuReady);

    // Fallback con polling conservador (cada 200ms, no 100ms)
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
 * Registra un componente React como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend (debe coincidir con wu.json)
 * @param {React.ComponentType} Component - Componente React principal
 * @param {Object} options - Opciones adicionales
 * @param {boolean} options.strictMode - Envolver en StrictMode (default: true)
 * @param {Object} options.props - Props iniciales para el componente
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#root')
 */
async function register(appName, Component, options = {}) {
  const {
    strictMode = true,
    props = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root'
  } = options;

  // Asegurar que React está disponible
  const hasReact = await ensureReact();
  if (!hasReact) {
    console.error(`[WuReact] Cannot register ${appName}: React not available`);
    return false;
  }

  const { React, createRoot } = adapterState;

  // Función de mount interna
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuReact] Mount failed for ${appName}: container is null`);
      return;
    }

    // Si ya está montado en el MISMO container, ignorar
    const existing = adapterState.roots.get(appName);
    if (existing) {
      if (existing.container === container) {
        return; // Ya montado aquí, nada que hacer
      }
      // Diferente container → desmontar primero
      unmountApp();
    }

    try {
      container.innerHTML = '';
      const root = createRoot(container);

      let element = React.createElement(Component, props);
      if (strictMode && React.StrictMode) {
        element = React.createElement(React.StrictMode, null, element);
      }

      root.render(element);
      adapterState.roots.set(appName, { root, container });

      if (onMount) {
        onMount(container);
      }
    } catch (error) {
      console.error(`[WuReact] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Unmount inmediato — la protección contra StrictMode (deferred unmount)
  // se maneja en wu-core.js, no aquí en el adapter.
  const unmountApp = (container) => {
    const instance = adapterState.roots.get(appName);
    if (instance) {
      try {
        if (onUnmount) onUnmount(instance.container);
        instance.root.unmount();
        adapterState.roots.delete(appName);
      } catch (error) {
        console.error(`[WuReact] Unmount error for ${appName}:`, error);
      }
    }
    const target = container || instance?.container;
    if (target) target.innerHTML = '';
  };

  // Intentar registrar con Wu Framework
  try {
    const wu = await waitForWu(3000);

    wu.define(appName, {
      mount: mountApp,
      unmount: unmountApp
    });

    console.log(`[WuReact] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    // Wu no disponible
    console.warn(`[WuReact] Wu Framework not available for ${appName}`);

    // Modo standalone si está habilitado
    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuReact] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      } else {
        console.warn(`[WuReact] Standalone container ${standaloneContainer} not found`);
      }
    }

    return false;
  }
}

/**
 * Crea un componente React para cargar microfrontends (para el Shell)
 *
 * @example
 * import { createWuSlot } from 'wu-framework/adapters/react';
 * const WuSlot = createWuSlot(React);
 *
 * <WuSlot name="my-app" url="http://localhost:3001" />
 */
function createWuSlot(React) {
  const { useState, useEffect, useRef, useCallback } = React;

  return function WuSlot({
    name,
    url,
    appName = null,
    fallback = null,
    onLoad = null,
    onError = null,
    onMount = null,
    onUnmount = null,
    className = '',
    style = {},
    ...props
  }) {
    const containerRef = useRef(null);
    const appInstanceRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const actualAppName = appName || name;

    useEffect(() => {
      let cancelled = false;
      const containerId = `wu-slot-${actualAppName}-${Math.random().toString(36).slice(2, 8)}`;

      // Delay de 50ms para compatibilidad con React 18/19 StrictMode.
      // En StrictMode el primer efecto se cancela inmediatamente (cancelled = true,
      // clearTimeout) y solo el segundo efecto monta; evita doble-mount y
      // "[Wu] App not mounted" en primera carga.
      const timer = setTimeout(async () => {
        if (cancelled || !containerRef.current) return;

        try {
          setLoading(true);
          setError(null);

          const wu = getWuInstance();
          if (!wu) {
            throw new Error('Wu Framework not initialized');
          }

          // Crear container interno
          const innerContainer = document.createElement('div');
          innerContainer.id = containerId;
          innerContainer.style.width = '100%';
          innerContainer.style.height = '100%';
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(innerContainer);

          // Montar usando wu.mount() (wu.init() ya se llamó en el shell)
          await wu.mount(actualAppName, `#${containerId}`);

          if (!cancelled) {
            appInstanceRef.current = actualAppName;
            setLoading(false);

            if (onLoad) onLoad({ name: actualAppName, url });
            if (onMount) onMount({ name: actualAppName, container: innerContainer });
          }
        } catch (err) {
          if (!cancelled) {
            console.error(`[WuSlot] Error loading ${actualAppName}:`, err);
            setError(err.message || 'Failed to load microfrontend');
            setLoading(false);

            if (onError) onError(err);
          }
        }
      }, 50);

      return () => {
        cancelled = true;
        clearTimeout(timer);

        if (appInstanceRef.current) {
          if (onUnmount) onUnmount({ name: actualAppName });

          const wu = getWuInstance();
          if (wu) {
            wu.unmount(actualAppName).catch(() => {});
          }
          appInstanceRef.current = null;
        }
      };
    }, [actualAppName, url, onLoad, onError, onMount, onUnmount]);

    // Render de error
    if (error) {
      return React.createElement('div', {
        className: `wu-slot wu-slot-error ${className}`,
        style: {
          padding: '1rem',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          ...style
        },
        ...props
      }, [
        React.createElement('strong', { key: 'title' }, `Error loading ${name}`),
        React.createElement('p', { key: 'message', style: { margin: '0.5rem 0 0 0' } }, error)
      ]);
    }

    // Render principal
    return React.createElement('div', {
      ref: containerRef,
      className: `wu-slot ${loading ? 'wu-slot-loading' : 'wu-slot-loaded'} ${className}`,
      style: {
        minHeight: '100px',
        position: 'relative',
        ...style
      },
      'data-wu-app': actualAppName,
      'data-wu-url': url,
      ...props
    }, loading && (fallback || React.createElement('div', {
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
 * Hook para usar el EventBus de Wu Framework en React
 *
 * @example
 * const { emit, on } = useWuEvents();
 *
 * useEffect(() => {
 *   const unsub = on('user:login', (data) => console.log(data));
 *   return unsub;
 * }, [on]);
 */
function createUseWuEvents(React) {
  const { useCallback, useEffect, useRef } = React;

  return function useWuEvents() {
    const subscriptionsRef = useRef([]);

    const emit = useCallback((event, data, options) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        wu.eventBus.emit(event, data, options);
      } else {
        console.warn('[useWuEvents] Wu Framework not available');
      }
    }, []);

    const on = useCallback((event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        const unsubscribe = wu.eventBus.on(event, callback);
        subscriptionsRef.current.push(unsubscribe);
        return unsubscribe;
      }
      console.warn('[useWuEvents] Wu Framework not available');
      return () => {};
    }, []);

    const once = useCallback((event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        return wu.eventBus.once(event, callback);
      }
      console.warn('[useWuEvents] Wu Framework not available');
      return () => {};
    }, []);

    // Cleanup on unmount
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
 * Hook para usar el Store de Wu Framework en React
 *
 * @example
 * const { state, setState, subscribe } = useWuStore('user');
 */
function createUseWuStore(React) {
  const { useState, useCallback, useEffect } = React;

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

    // Subscribe to changes
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

/**
 * Hook para integrar wu.ai con React (Paradigma C: IA como Director de Orquesta)
 *
 * Manages messages, streaming state, and AI interaction lifecycle.
 * The AI calls business-level actions that orchestrate the UI via wu.emit/wu.store.
 *
 * @example
 * const { messages, send, isStreaming } = useWuAI();
 *
 * await send('Navigate to users page');
 * // AI calls 'navigate' action → wu.emit('shell:navigate') → UI reacts
 */
function createUseWuAI(React) {
  const { useState, useCallback, useRef, useEffect } = React;

  return function useWuAI(options = {}) {
    const { namespace = 'default', onActionExecuted = null } = options;

    const [messages, setMessages] = useState([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState(null);
    const abortRef = useRef(null);
    const actionListenerRef = useRef(null);

    // Listen for action execution events to provide visual feedback
    useEffect(() => {
      const wu = getWuInstance();
      if (!wu?.eventBus) return;

      const unsub = wu.eventBus.on('ai:action:executed', (event) => {
        const actionMsg = {
          id: `action-${Date.now()}`,
          role: 'action',
          content: event.data?.action || 'action',
          result: event.data?.result,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, actionMsg]);
        if (onActionExecuted) onActionExecuted(event.data);
      });

      actionListenerRef.current = unsub;
      return () => { if (unsub) unsub(); };
    }, [onActionExecuted]);

    /**
     * Send a message and stream the response in real-time.
     */
    const send = useCallback(async (text) => {
      if (!text?.trim()) return;

      const wu = getWuInstance();
      if (!wu?.ai) {
        setError('Wu AI not available');
        return;
      }

      // Add user message
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setError(null);
      setIsStreaming(true);

      // Create assistant placeholder
      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }]);

      try {
        let fullContent = '';

        for await (const chunk of wu.ai.stream(text, { namespace })) {
          if (chunk.type === 'text') {
            fullContent += chunk.content;
            const captured = fullContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: captured } : m,
              ),
            );
          }

          if (chunk.type === 'tool_result') {
            // Tool results are handled by the ai:action:executed listener
          }

          if (chunk.type === 'error') {
            setError(chunk.error?.message || 'AI request failed');
          }
        }
      } catch (err) {
        setError(err.message || 'AI request failed');
        // Remove empty assistant message on error
        setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
      } finally {
        setIsStreaming(false);
      }
    }, [namespace]);

    /**
     * Send without streaming (simpler, waits for full response).
     */
    const sendSync = useCallback(async (text) => {
      if (!text?.trim()) return null;

      const wu = getWuInstance();
      if (!wu?.ai) {
        setError('Wu AI not available');
        return null;
      }

      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setError(null);
      setIsStreaming(true);

      try {
        const response = await wu.ai.send(text, { namespace });

        const assistantMsg = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        return response;
      } catch (err) {
        setError(err.message || 'AI request failed');
        return null;
      } finally {
        setIsStreaming(false);
      }
    }, [namespace]);

    const abort = useCallback(() => {
      const wu = getWuInstance();
      if (wu?.ai) wu.ai.abort(namespace);
      setIsStreaming(false);
    }, [namespace]);

    const clear = useCallback(() => {
      setMessages([]);
      setError(null);
      const wu = getWuInstance();
      if (wu?.ai) wu.ai.conversation.clear(namespace);
    }, [namespace]);

    return {
      messages,
      isStreaming,
      error,
      send,
      sendSync,
      abort,
      clear,
    };
  };
}

// API pública del adapter
export const wuReact = {
  register,
  createWuSlot,
  createUseWuEvents,
  createUseWuStore,
  createUseWuAI,
  getWuInstance,
  waitForWu
};

// Named exports para conveniencia
export {
  register,
  createWuSlot,
  createUseWuEvents,
  createUseWuStore,
  createUseWuAI,
  getWuInstance,
  waitForWu
};

export default wuReact;
