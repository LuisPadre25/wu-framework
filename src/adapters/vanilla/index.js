/**
 * 🚀 WU-FRAMEWORK VANILLA JS ADAPTER
 *
 * El adapter más simple - Para JavaScript puro sin frameworks.
 * Ideal para microfrontends ligeros o legacy code.
 *
 * @example
 * // Microfrontend (main.js)
 * import { wuVanilla } from 'wu-framework/adapters/vanilla';
 *
 * wuVanilla.register('my-app', {
 *   render: (container) => {
 *     container.innerHTML = '<h1>Hello World</h1>';
 *   }
 * });
 *
 * @example
 * // Con clase
 * class MyApp {
 *   constructor(container) {
 *     this.container = container;
 *   }
 *   render() {
 *     this.container.innerHTML = '<h1>My App</h1>';
 *   }
 *   destroy() {
 *     this.container.innerHTML = '';
 *   }
 * }
 *
 * wuVanilla.registerClass('my-app', MyApp);
 */

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  instances: new Map()
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
 * Registra una app Vanilla JS como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {Object} config - Configuración de la app
 * @param {Function} config.render - Función para renderizar (recibe container)
 * @param {Function} [config.destroy] - Función para limpiar (recibe container)
 * @param {Function} [config.init] - Función de inicialización (recibe container)
 * @param {Object} [config.state] - Estado inicial
 * @param {Object} options - Opciones adicionales
 *
 * @example
 * wuVanilla.register('counter', {
 *   state: { count: 0 },
 *   init: (container) => {
 *     console.log('Initializing...');
 *   },
 *   render: (container, state) => {
 *     container.innerHTML = `
 *       <div>
 *         <h1>Count: ${state.count}</h1>
 *         <button id="increment">+</button>
 *       </div>
 *     `;
 *     container.querySelector('#increment').onclick = () => {
 *       state.count++;
 *       // Re-render
 *     };
 *   },
 *   destroy: (container) => {
 *     container.innerHTML = '';
 *   }
 * });
 */
async function register(appName, config, options = {}) {
  const {
    render,
    destroy = null,
    init = null,
    state = {}
  } = config;

  const {
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  if (!render || typeof render !== 'function') {
    throw new Error(`[WuVanilla] render function is required for ${appName}`);
  }

  // Estado local de la app
  let appState = { ...state };

  // Función de mount
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuVanilla] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuVanilla] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      // Limpiar container
      container.innerHTML = '';

      // Ejecutar init si existe
      if (init && typeof init === 'function') {
        init(container, appState);
      }

      // Renderizar
      render(container, appState);

      // Guardar referencia
      adapterState.apps.set(appName, {
        container,
        config,
        state: appState
      });

      console.log(`[WuVanilla] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container, appState);
      }
    } catch (error) {
      console.error(`[WuVanilla] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount
  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container, appData.state);
        }

        // Ejecutar destroy si existe
        if (destroy && typeof destroy === 'function') {
          destroy(appData.container, appData.state);
        } else {
          // Cleanup por defecto
          appData.container.innerHTML = '';
        }

        adapterState.apps.delete(appName);

        console.log(`[WuVanilla] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuVanilla] Unmount error for ${appName}:`, error);
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

    console.log(`[WuVanilla] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuVanilla] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuVanilla] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Registra una clase como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {Function} AppClass - Clase con constructor(container) y métodos render/destroy
 * @param {Object} options - Opciones adicionales
 *
 * @example
 * class TodoApp {
 *   constructor(container) {
 *     this.container = container;
 *     this.todos = [];
 *   }
 *
 *   render() {
 *     this.container.innerHTML = `
 *       <ul>${this.todos.map(t => `<li>${t}</li>`).join('')}</ul>
 *     `;
 *   }
 *
 *   addTodo(text) {
 *     this.todos.push(text);
 *     this.render();
 *   }
 *
 *   destroy() {
 *     this.container.innerHTML = '';
 *     this.todos = [];
 *   }
 * }
 *
 * wuVanilla.registerClass('todo-app', TodoApp);
 */
async function registerClass(appName, AppClass, options = {}) {
  const {
    constructorArgs = [],
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  // Función de mount
  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuVanilla] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.instances.has(appName)) {
      console.warn(`[WuVanilla] ${appName} already mounted, unmounting first`);
      unmountApp();
    }

    try {
      container.innerHTML = '';

      // Crear instancia de la clase
      const instance = new AppClass(container, ...constructorArgs);

      // Llamar render si existe
      if (instance.render && typeof instance.render === 'function') {
        instance.render();
      }

      // Guardar instancia
      adapterState.instances.set(appName, {
        instance,
        container
      });

      console.log(`[WuVanilla] ✅ ${appName} (class) mounted successfully`);

      if (onMount) {
        onMount(container, instance);
      }
    } catch (error) {
      console.error(`[WuVanilla] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount
  const unmountApp = (container) => {
    const appData = adapterState.instances.get(appName);

    if (appData) {
      try {
        if (onUnmount) {
          onUnmount(appData.container, appData.instance);
        }

        // Llamar destroy si existe
        if (appData.instance.destroy && typeof appData.instance.destroy === 'function') {
          appData.instance.destroy();
        } else {
          appData.container.innerHTML = '';
        }

        adapterState.instances.delete(appName);

        console.log(`[WuVanilla] ✅ ${appName} (class) unmounted successfully`);
      } catch (error) {
        console.error(`[WuVanilla] Unmount error for ${appName}:`, error);
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

    console.log(`[WuVanilla] ✅ ${appName} (class) registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuVanilla] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuVanilla] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Registra un template HTML como microfrontend
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {string|Function} template - HTML string o función que retorna HTML
 * @param {Object} options - Opciones adicionales
 *
 * @example
 * // Template estático
 * wuVanilla.registerTemplate('header', '<header><h1>My Header</h1></header>');
 *
 * // Template dinámico
 * wuVanilla.registerTemplate('greeting', (data) => `<h1>Hello ${data.name}!</h1>`, {
 *   data: { name: 'World' }
 * });
 */
async function registerTemplate(appName, template, options = {}) {
  const {
    data = {},
    scripts = [],
    styles = [],
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#app'
  } = options;

  const mountApp = (container) => {
    if (!container) {
      console.error(`[WuVanilla] Mount failed for ${appName}: container is null`);
      return;
    }

    try {
      container.innerHTML = '';

      // Inyectar estilos
      if (styles.length > 0) {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles.join('\n');
        styleEl.setAttribute('data-wu-app', appName);
        container.appendChild(styleEl);
      }

      // Crear wrapper
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-wu-template', appName);

      // Renderizar template
      if (typeof template === 'function') {
        wrapper.innerHTML = template(data);
      } else {
        wrapper.innerHTML = template;
      }

      container.appendChild(wrapper);

      // Ejecutar scripts
      scripts.forEach(scriptFn => {
        if (typeof scriptFn === 'function') {
          scriptFn(container, data);
        }
      });

      adapterState.apps.set(appName, { container, template, data });

      console.log(`[WuVanilla] ✅ ${appName} (template) mounted successfully`);

      if (onMount) {
        onMount(container, data);
      }
    } catch (error) {
      console.error(`[WuVanilla] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  const unmountApp = (container) => {
    const appData = adapterState.apps.get(appName);

    if (appData) {
      if (onUnmount) {
        onUnmount(appData.container, appData.data);
      }

      appData.container.innerHTML = '';
      adapterState.apps.delete(appName);

      console.log(`[WuVanilla] ✅ ${appName} (template) unmounted successfully`);
    }

    if (container) {
      container.innerHTML = '';
    }
  };

  try {
    const wu = await waitForWu(3000);

    wu.define(appName, {
      mount: mountApp,
      unmount: unmountApp
    });

    console.log(`[WuVanilla] ✅ ${appName} (template) registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuVanilla] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);
      if (containerElement) {
        console.log(`[WuVanilla] Running ${appName} in standalone mode`);
        mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Helper para crear un componente reactivo simple
 *
 * @param {Object} config - Configuración del componente
 * @returns {Object} Componente con métodos de estado
 *
 * @example
 * const Counter = wuVanilla.createComponent({
 *   state: { count: 0 },
 *   template: (state) => `
 *     <div>
 *       <h1>Count: ${state.count}</h1>
 *       <button data-action="increment">+</button>
 *       <button data-action="decrement">-</button>
 *     </div>
 *   `,
 *   actions: {
 *     increment: (state) => ({ count: state.count + 1 }),
 *     decrement: (state) => ({ count: state.count - 1 })
 *   }
 * });
 *
 * wuVanilla.register('counter', Counter);
 */
function createComponent(config) {
  const { state: initialState = {}, template, actions = {}, onInit, onDestroy } = config;

  let currentState = { ...initialState };
  let container = null;
  let mounted = false;

  const setState = (newState) => {
    currentState = { ...currentState, ...newState };
    if (mounted && container) {
      render(container, currentState);
    }
  };

  const render = (cont, state) => {
    const html = template(state);

    // Preservar focus si es posible
    const activeId = document.activeElement?.id;

    cont.innerHTML = html;

    // Restaurar focus
    if (activeId) {
      const el = cont.querySelector(`#${activeId}`);
      if (el) el.focus();
    }

    // Bind actions
    cont.querySelectorAll('[data-action]').forEach(el => {
      const actionName = el.getAttribute('data-action');
      if (actions[actionName]) {
        el.addEventListener('click', () => {
          const result = actions[actionName](currentState, el);
          if (result) {
            setState(result);
          }
        });
      }
    });
  };

  return {
    state: currentState,

    init: (cont) => {
      container = cont;
      if (onInit) onInit(cont, currentState);
    },

    render: (cont, state) => {
      container = cont;
      currentState = state || currentState;
      mounted = true;
      render(cont, currentState);
    },

    destroy: (cont) => {
      if (onDestroy) onDestroy(cont, currentState);
      mounted = false;
      container = null;
      cont.innerHTML = '';
    },

    // Exponer setState para uso externo
    setState,
    getState: () => currentState
  };
}

/**
 * Helper para usar eventos de Wu Framework
 */
function useWuEvents() {
  const subscriptions = [];

  return {
    emit: (event, data, options) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        wu.eventBus.emit(event, data, options);
      }
    },

    on: (event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        const unsubscribe = wu.eventBus.on(event, callback);
        subscriptions.push(unsubscribe);
        return unsubscribe;
      }
      return () => {};
    },

    once: (event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        return wu.eventBus.once(event, callback);
      }
      return () => {};
    },

    off: (event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        wu.eventBus.off(event, callback);
      }
    },

    cleanup: () => {
      subscriptions.forEach(unsub => unsub());
      subscriptions.length = 0;
    }
  };
}

/**
 * Helper para usar el Store de Wu Framework
 */
function useWuStore(namespace = '') {
  return {
    get: (path = '') => {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? (path ? `${namespace}.${path}` : namespace) : path;
        return wu.store.get(fullPath);
      }
      return null;
    },

    set: (path, value) => {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPath = namespace ? `${namespace}.${path}` : path;
        wu.store.set(fullPath, value);
      }
    },

    onChange: (pattern, callback) => {
      const wu = getWuInstance();
      if (wu?.store) {
        const fullPattern = namespace ? `${namespace}.${pattern}` : pattern;
        return wu.store.on(fullPattern, callback);
      }
      return () => {};
    }
  };
}

/**
 * Crea un WuSlot en JavaScript puro
 */
function createWuSlot(target, props) {
  const { name, url, fallbackText = null, onLoad = null, onError = null } = props;

  const container = document.createElement('div');
  container.className = 'wu-slot';
  container.style.cssText = 'min-height: 100px; position: relative;';
  container.setAttribute('data-wu-app', name);
  container.setAttribute('data-wu-url', url);

  // Loading state
  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
      ${fallbackText || `Loading ${name}...`}
    </div>
  `;

  target.appendChild(container);

  let appInstance = null;

  const mount = async () => {
    try {
      const wu = getWuInstance();
      if (!wu) throw new Error('Wu Framework not initialized');

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

      appInstance = app;
      await app.mount();

      if (onLoad) onLoad({ name, url });

    } catch (err) {
      container.innerHTML = `
        <div style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
          <strong>Error loading ${name}</strong>
          <p style="margin: 0.5rem 0 0 0;">${err.message}</p>
        </div>
      `;
      if (onError) onError(err);
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

  return { container, destroy };
}

// ============================================
// AI INTEGRATION
// ============================================
export { useWuAI } from './ai.js';
import { useWuAI } from './ai.js';

// API pública del adapter
export const wuVanilla = {
  register,
  registerClass,
  registerTemplate,
  createComponent,
  createWuSlot,
  useWuEvents,
  useWuStore,
  useWuAI,
  getWuInstance,
  waitForWu
};

export default wuVanilla;
