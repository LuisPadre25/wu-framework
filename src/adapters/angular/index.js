/**
 * 🚀 WU-FRAMEWORK ANGULAR ADAPTER
 *
 * Integrates Angular (14+) with Wu Framework as microfrontends.
 * Supports NgModule-based apps, standalone components, and Angular Elements.
 * Works inside Shadow DOM (wu-framework's default isolation mode).
 *
 * ## Quick Start — Standalone Component (recommended)
 *
 * ```ts
 * // main.ts
 * import 'zone.js';
 * import '@angular/compiler'; // JIT mode (no AOT plugin needed)
 * import { createApplication } from '@angular/platform-browser';
 * import { createComponent, provideZoneChangeDetection } from '@angular/core';
 * import { wuAngular } from 'wu-framework/adapters/angular';
 * import { AppComponent } from './app/app.component';
 *
 * wuAngular.registerStandalone('my-app', AppComponent, {
 *   createApplication,       // pass Angular APIs to avoid bundler issues
 *   createComponent,
 *   provideZoneChangeDetection,
 * });
 * ```
 *
 * ## Using Wu Events & Store inside Angular
 *
 * ```ts
 * import { createWuService } from 'wu-framework/adapters/angular';
 *
 * @Component({ ... })
 * export class MyComponent implements OnInit, OnDestroy {
 *   private wu = createWuService();
 *
 *   ngOnInit() {
 *     this.wu.on('some:event', (data) => { ... });
 *     const user = this.wu.getState('user');
 *   }
 *
 *   ngOnDestroy() {
 *     this.wu.destroy(); // cleans up all subscriptions
 *   }
 * }
 * ```
 *
 * ## Vite Setup (no AnalogJS required)
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * export default defineConfig({
 *   server: { port: 5008, cors: true },
 *   esbuild: { target: 'es2022' },
 * });
 * ```
 *
 * ```json
 * // tsconfig.json — enable decorators for esbuild
 * { "compilerOptions": { "experimentalDecorators": true, "useDefineForClassFields": false } }
 * ```
 *
 * ## Why pass Angular APIs as options?
 *
 * When wu-framework is linked via `file:` or a monorepo, bundlers (Vite, Rollup)
 * resolve imports relative to the adapter's source file — NOT your app's node_modules.
 * Passing `createApplication`, `createComponent`, etc. from your own imports ensures
 * the bundler resolves them from your app's dependencies. The adapter falls back to
 * dynamic imports for environments where this isn't an issue (Webpack, non-bundled).
 */

/**
 * Dynamic import helper — passes the module path through a function parameter
 * so that bundlers (Vite, Rollup, Webpack) cannot statically resolve it.
 * This is necessary because Angular dependencies (@angular/platform-browser-dynamic,
 * @angular/elements, etc.) are optional and may not be installed.
 */
function _optionalImport(modulePath) {
  return import(/* @vite-ignore */ modulePath);
}

// Estado global del adapter
const adapterState = {
  apps: new Map(),
  platformRef: null,
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
 * Register an NgModule-based Angular app as a microfrontend.
 *
 * NOTE: Uses platformBrowserDynamic + bootstrapModule which does NOT work inside
 * Shadow DOM (it calls document.querySelector internally). For Shadow DOM compatibility,
 * use registerStandalone() instead — it uses createApplication + createComponent with
 * an explicit hostElement, which works everywhere.
 *
 * @param {string} appName - Unique name for the microfrontend
 * @param {Type<any>} AppModule - Main Angular module (e.g. AppModule)
 * @param {Object} options
 * @param {Function} options.platformFactory - platformBrowserDynamic (pass it to avoid bundler issues)
 * @param {Array} options.providers - Additional bootstrap providers
 * @param {Function} options.onMount - Called after mount
 * @param {Function} options.onUnmount - Called before unmount
 * @param {boolean} options.standalone - Allow standalone fallback (default: true)
 * @param {string} options.standaloneContainer - Selector for standalone mode (default: '#root')
 * @param {string} options.rootSelector - Root component selector (default: 'app-root')
 *
 * @example
 * import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
 * import { wuAngular } from 'wu-framework/adapters/angular';
 * import { AppModule } from './app/app.module';
 *
 * wuAngular.register('my-app', AppModule, {
 *   platformFactory: platformBrowserDynamic, // pass to avoid bundler issues
 * });
 */
async function register(appName, AppModule, options = {}) {
  const {
    platformFactory = null,
    providers = [],
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root',
    rootSelector = 'app-root'
  } = options;

  // Función de mount interna
  const mountApp = async (container) => {
    if (!container) {
      console.error(`[WuAngular] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuAngular] ${appName} already mounted, unmounting first`);
      await unmountApp();
    }

    try {
      // Crear elemento root para Angular
      const appElement = document.createElement(rootSelector);
      appElement.setAttribute('data-wu-angular-root', appName);
      container.innerHTML = '';
      container.appendChild(appElement);

      // Obtener platformBrowserDynamic
      let platform;
      if (platformFactory) {
        platform = platformFactory;
      } else {
        // Intentar import dinámico
        try {
          const platformModule = await _optionalImport('@angular/platform-browser-dynamic');
          platform = platformModule.platformBrowserDynamic;
        } catch (e) {
          // Intentar desde window
          if (window.ng?.platformBrowserDynamic) {
            platform = window.ng.platformBrowserDynamic;
          } else {
            throw new Error('platformBrowserDynamic not available. Please provide it via options.platformFactory');
          }
        }
      }

      // Bootstrap del módulo
      const platformRef = platform(providers);
      const moduleRef = await platformRef.bootstrapModule(AppModule);

      // Guardar referencias
      adapterState.apps.set(appName, {
        platformRef,
        moduleRef,
        container,
        rootElement: appElement
      });

      console.log(`[WuAngular] ✅ ${appName} mounted successfully`);

      if (onMount) {
        onMount(container, moduleRef);
      }
    } catch (error) {
      console.error(`[WuAngular] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount interna
  const unmountApp = async (container) => {
    const instance = adapterState.apps.get(appName);

    if (instance) {
      try {
        if (onUnmount) {
          onUnmount(instance.container, instance.moduleRef);
        }

        // Destruir el módulo
        if (instance.moduleRef) {
          instance.moduleRef.destroy();
        }

        // Destruir la plataforma
        if (instance.platformRef) {
          instance.platformRef.destroy();
        }

        // Limpiar DOM
        if (instance.rootElement && instance.rootElement.parentNode) {
          instance.rootElement.parentNode.removeChild(instance.rootElement);
        }

        adapterState.apps.delete(appName);

        console.log(`[WuAngular] ✅ ${appName} unmounted successfully`);
      } catch (error) {
        console.error(`[WuAngular] Unmount error for ${appName}:`, error);
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

    console.log(`[WuAngular] ✅ ${appName} registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuAngular] Wu Framework not available for ${appName}`);

    // Modo standalone si está habilitado
    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuAngular] Running ${appName} in standalone mode`);
        await mountApp(containerElement);
        return true;
      } else {
        console.warn(`[WuAngular] Standalone container ${standaloneContainer} not found`);
      }
    }

    return false;
  }
}

/**
 * Registra un componente Angular standalone como microfrontend (Angular 14+)
 *
 * @param {string} appName - Nombre único del microfrontend
 * @param {Type<any>} RootComponent - Componente standalone principal
 * @param {Object} options - Opciones adicionales
 * @param {ApplicationConfig} options.appConfig - Configuración de la aplicación
 * @param {Function} options.onMount - Callback después de montar
 * @param {Function} options.onUnmount - Callback antes de desmontar
 * @param {boolean} options.standalone - Permitir ejecución standalone (default: true)
 * @param {string} options.standaloneContainer - Selector para modo standalone (default: '#root')
 * @param {Function} options.createApplication - createApplication from @angular/platform-browser (recommended to avoid bundler issues)
 * @param {Function} options.createComponent - createComponent from @angular/core
 * @param {Function} options.provideZoneChangeDetection - provideZoneChangeDetection from @angular/core
 *
 * @example
 * // Angular 14+ con standalone components
 * import { AppComponent } from './app/app.component';
 * import { createApplication } from '@angular/platform-browser';
 * import { createComponent, provideZoneChangeDetection } from '@angular/core';
 *
 * wuAngular.registerStandalone('my-app', AppComponent, {
 *   createApplication,
 *   createComponent,
 *   provideZoneChangeDetection,
 * });
 */
async function registerStandalone(appName, RootComponent, options = {}) {
  const {
    appConfig = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root',
    createApplication: createApplicationOpt = null,
    createComponent: createComponentOpt = null,
    provideZoneChangeDetection: provideZoneChangeDetectionOpt = null
  } = options;

  // Función de mount para standalone components
  const mountApp = async (container) => {
    if (!container) {
      console.error(`[WuAngular] Mount failed for ${appName}: container is null`);
      return;
    }

    // Evitar doble mount
    if (adapterState.apps.has(appName)) {
      console.warn(`[WuAngular] ${appName} already mounted, unmounting first`);
      await unmountApp();
    }

    try {
      // Resolve Angular APIs: prefer options > dynamic import > window.ng
      let createApplicationFn = createApplicationOpt;
      let createComponentFn = createComponentOpt;
      let provideZoneChangeDetectionFn = provideZoneChangeDetectionOpt;

      if (!createApplicationFn) {
        try {
          const browserModule = await _optionalImport('@angular/platform-browser');
          createApplicationFn = browserModule.createApplication;
          const coreModule = await _optionalImport('@angular/core');
          createComponentFn = coreModule.createComponent;
          provideZoneChangeDetectionFn = coreModule.provideZoneChangeDetection;
        } catch (e) {
          if (window.ng?.createApplication) {
            createApplicationFn = window.ng.createApplication;
            createComponentFn = window.ng.createComponent;
            provideZoneChangeDetectionFn = window.ng.provideZoneChangeDetection;
          } else {
            throw new Error(
              'Angular APIs not available. Pass createApplication, createComponent via options, ' +
              'or ensure @angular/platform-browser is resolvable. See docs for example.'
            );
          }
        }
      }

      // Merge providers: add zone change detection if available
      const providers = [...(appConfig.providers || [])];
      if (provideZoneChangeDetectionFn) {
        providers.push(provideZoneChangeDetectionFn({ eventCoalescing: true }));
      }

      // Create Angular application
      const appRef = await createApplicationFn({ providers });

      // Create host element inside the container (Shadow DOM compatible)
      container.innerHTML = '';
      const selector = RootComponent.ɵcmp?.selectors?.[0]?.[0]
        || RootComponent.__annotations__?.[0]?.selector
        || 'app-root';
      const hostEl = document.createElement(selector);
      container.appendChild(hostEl);

      // Create and attach the component using hostElement (bypasses document.querySelector)
      const compRef = createComponentFn(RootComponent, {
        environmentInjector: appRef.injector,
        hostElement: hostEl,
      });
      appRef.attachView(compRef.hostView);

      // Guardar referencias
      adapterState.apps.set(appName, {
        appRef,
        compRef,
        container,
        hostElement: hostEl,
        isStandalone: true
      });

      console.log(`[WuAngular] ✅ ${appName} (standalone) mounted successfully`);

      if (onMount) {
        onMount(container, appRef);
      }
    } catch (error) {
      console.error(`[WuAngular] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount para standalone
  const unmountApp = async (container) => {
    const instance = adapterState.apps.get(appName);

    if (instance) {
      try {
        if (onUnmount) {
          onUnmount(instance.container, instance.appRef);
        }

        // Destruir el componente
        if (instance.compRef) {
          instance.compRef.destroy();
        }

        // Destruir la aplicación
        if (instance.appRef) {
          instance.appRef.destroy();
        }

        adapterState.apps.delete(appName);

        console.log(`[WuAngular] ✅ ${appName} (standalone) unmounted successfully`);
      } catch (error) {
        console.error(`[WuAngular] Unmount error for ${appName}:`, error);
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

    console.log(`[WuAngular] ✅ ${appName} (standalone) registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuAngular] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuAngular] Running ${appName} in standalone mode`);
        await mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Register an Angular Elements (Web Component) as a microfrontend.
 * Requires @angular/elements to be installed.
 *
 * @param {string} appName - Unique microfrontend name
 * @param {Type<any>} Component - Angular standalone component
 * @param {Object} options
 * @param {string} options.elementTag - Custom element tag (default: `${appName}-element`)
 * @param {ApplicationConfig} options.appConfig - Angular application config
 * @param {Function} options.onMount - Called after mount
 * @param {Function} options.onUnmount - Called before unmount
 * @param {boolean} options.standalone - Allow standalone fallback (default: true)
 * @param {string} options.standaloneContainer - Selector for standalone mode (default: '#root')
 *
 * @example
 * import { wuAngular } from 'wu-framework/adapters/angular';
 * import { AppComponent } from './app/app.component';
 *
 * wuAngular.registerElement('mfe-angular', AppComponent, {
 *   elementTag: 'mfe-angular-content',
 * });
 */
async function registerElement(appName, Component, options = {}) {
  const {
    elementTag = `${appName}-element`,
    appConfig = {},
    onMount = null,
    onUnmount = null,
    standalone = true,
    standaloneContainer = '#root'
  } = options;

  let customElementRegistered = false;

  // Función para inicializar Angular Elements
  const initializeElement = async () => {
    if (customElementRegistered) return true;

    try {
      // Import dinámico de Angular
      const [{ createApplication }, { createCustomElement }] = await Promise.all([
        _optionalImport('@angular/platform-browser'),
        _optionalImport('@angular/elements')
      ]);

      // Crear aplicación Angular
      const app = await createApplication(appConfig);

      // Crear y registrar el custom element
      const CustomElement = createCustomElement(Component, { injector: app.injector });

      if (!customElements.get(elementTag)) {
        customElements.define(elementTag, CustomElement);
        console.log(`[WuAngular] ✅ Custom element registered: ${elementTag}`);
      }

      customElementRegistered = true;

      // Guardar referencia
      adapterState.apps.set(`${appName}:element`, {
        app,
        elementTag,
        CustomElement
      });

      return true;
    } catch (error) {
      console.error(`[WuAngular] Failed to initialize Angular Element:`, error);
      throw error;
    }
  };

  // Función de mount
  const mountApp = async (container) => {
    if (!container) {
      console.error(`[WuAngular] Mount failed for ${appName}: container is null`);
      return;
    }

    try {
      // Asegurar que el elemento está registrado
      await initializeElement();

      // Crear el elemento custom
      const element = document.createElement(elementTag);
      element.setAttribute('data-wu-angular-element', appName);

      // Limpiar y agregar al container
      container.innerHTML = '';
      container.appendChild(element);

      // Guardar referencia del mount
      adapterState.apps.set(appName, {
        element,
        container,
        elementTag
      });

      console.log(`[WuAngular] ✅ ${appName} (element) mounted successfully`);

      if (onMount) {
        onMount(container, element);
      }

      return element;
    } catch (error) {
      console.error(`[WuAngular] Mount error for ${appName}:`, error);
      throw error;
    }
  };

  // Función de unmount
  const unmountApp = async (container) => {
    const instance = adapterState.apps.get(appName);

    if (instance) {
      try {
        if (onUnmount) {
          onUnmount(instance.container, instance.element);
        }

        // Remover elemento del DOM
        if (instance.element && instance.element.parentNode) {
          instance.element.remove();
        }

        adapterState.apps.delete(appName);

        console.log(`[WuAngular] ✅ ${appName} (element) unmounted successfully`);
      } catch (error) {
        console.error(`[WuAngular] Unmount error for ${appName}:`, error);
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

    console.log(`[WuAngular] ✅ ${appName} (element) registered with Wu Framework`);
    return true;

  } catch (error) {
    console.warn(`[WuAngular] Wu Framework not available for ${appName}`);

    if (standalone) {
      const containerElement = document.querySelector(standaloneContainer);

      if (containerElement) {
        console.log(`[WuAngular] Running ${appName} in standalone mode`);
        await mountApp(containerElement);
        return true;
      }
    }

    return false;
  }
}

/**
 * Creates a lightweight service for wu-framework events and store access.
 * Call destroy() in ngOnDestroy to clean up all subscriptions.
 *
 * @returns {{ emit, on, once, off, getState, setState, onStateChange, destroy, wu }}
 *
 * @example
 * import { createWuService } from 'wu-framework/adapters/angular';
 *
 * @Component({ selector: 'app-root', standalone: true, template: '...' })
 * export class AppComponent implements OnInit, OnDestroy {
 *   private wu = createWuService();
 *
 *   ngOnInit() {
 *     this.wu.on('order:new', (e) => this.orders.push(e.data));
 *     this.wu.onStateChange('theme.mode', (e) => this.theme = e.value);
 *     const user = this.wu.getState('user');
 *   }
 *
 *   save() {
 *     this.wu.setState('store.name', this.storeName);
 *     this.wu.emit('settings:saved', { name: this.storeName });
 *   }
 *
 *   ngOnDestroy() {
 *     this.wu.destroy(); // removes all on/onStateChange listeners
 *   }
 * }
 */
function createWuService() {
  const subscriptions = [];

  return {
    // Event Bus
    emit: (event, data, options) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        wu.eventBus.emit(event, data, options);
      } else {
        console.warn('[WuService] Wu Framework not available');
      }
    },

    on: (event, callback) => {
      const wu = getWuInstance();
      if (wu?.eventBus) {
        const unsubscribe = wu.eventBus.on(event, callback);
        subscriptions.push(unsubscribe);
        return unsubscribe;
      }
      console.warn('[WuService] Wu Framework not available');
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

    // Store
    getState: (path) => {
      const wu = getWuInstance();
      return wu?.store?.get(path) || null;
    },

    setState: (path, value) => {
      const wu = getWuInstance();
      if (wu?.store) {
        wu.store.set(path, value);
      }
    },

    onStateChange: (pattern, callback) => {
      const wu = getWuInstance();
      if (wu?.store) {
        const unsubscribe = wu.store.on(pattern, callback);
        subscriptions.push(unsubscribe);
        return unsubscribe;
      }
      return () => {};
    },

    // Cleanup
    destroy: () => {
      subscriptions.forEach(unsub => unsub());
      subscriptions.length = 0;
    },

    // Access to raw Wu instance
    get wu() {
      return getWuInstance();
    }
  };
}

/**
 * Crea un componente Angular para cargar microfrontends (para el Shell)
 * Retorna la configuración del componente para ser usado con @Component
 *
 * @example
 * // wu-slot.component.ts
 * import { Component, Input, Output, EventEmitter } from '@angular/core';
 * import { createWuSlotComponent } from 'wu-framework/adapters/angular';
 *
 * const config = createWuSlotComponent();
 *
 * @Component({
 *   selector: 'wu-slot',
 *   template: config.template,
 *   styles: config.styles
 * })
 * export class WuSlotComponent {
 *   @Input() name!: string;
 *   @Input() url!: string;
 *   @Output() load = new EventEmitter();
 *   @Output() error = new EventEmitter();
 *
 *   // ... implement lifecycle methods from config.methods
 * }
 */
function createWuSlotComponent() {
  return {
    selector: 'wu-slot',

    template: `
      <div
        #container
        class="wu-slot"
        [class.wu-slot-loading]="loading"
        [class.wu-slot-error]="error"
        [attr.data-wu-app]="name"
        [attr.data-wu-url]="url"
        style="min-height: 100px; position: relative;">

        <div *ngIf="error" class="wu-slot-error-message"
             style="padding: 1rem; border: 1px solid #f5c6cb; border-radius: 4px; background: #f8d7da; color: #721c24;">
          <strong>Error loading {{ name }}</strong>
          <p style="margin: 0.5rem 0 0 0;">{{ error }}</p>
        </div>

        <div *ngIf="loading && !error" class="wu-slot-loading-message"
             style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #666;">
          {{ fallbackText || 'Loading ' + name + '...' }}
        </div>
      </div>
    `,

    styles: [`
      .wu-slot {
        width: 100%;
        min-height: 100px;
      }
    `],

    // Métodos para implementar en el componente
    methods: {
      async ngOnInit() {
        await this.mountMicrofrontend();
      },

      ngOnDestroy() {
        this.unmountMicrofrontend();
      },

      async mountMicrofrontend() {
        try {
          this.loading = true;
          this.error = null;

          const wu = getWuInstance();
          if (!wu) {
            throw new Error('Wu Framework not initialized');
          }

          // Crear container único
          const containerId = `wu-slot-${this.name}-${Date.now()}`;
          const innerContainer = document.createElement('div');
          innerContainer.id = containerId;
          innerContainer.style.width = '100%';
          innerContainer.style.height = '100%';

          this.container.nativeElement.innerHTML = '';
          this.container.nativeElement.appendChild(innerContainer);

          // Crear y montar la app
          const app = wu.app(this.name, {
            url: this.url,
            container: `#${containerId}`,
            autoInit: true
          });

          this.appInstance = app;
          await app.mount();

          this.loading = false;
          this.load.emit({ name: this.name, url: this.url });

        } catch (err) {
          console.error(`[WuSlot] Error loading ${this.name}:`, err);
          this.error = err.message || 'Failed to load microfrontend';
          this.loading = false;
          this.errorEvent.emit(err);
        }
      },

      async unmountMicrofrontend() {
        if (this.appInstance) {
          try {
            await this.appInstance.unmount();
          } catch (err) {
            console.warn(`[WuSlot] Error unmounting ${this.name}:`, err);
          }
          this.appInstance = null;
        }
      }
    }
  };
}

/**
 * Helper para crear un módulo Angular que exporta WuSlotComponent
 * Útil para shells que quieren usar <wu-slot> directamente
 */
function getWuSlotModuleConfig() {
  return {
    imports: ['CommonModule'],
    declarations: ['WuSlotComponent'],
    exports: ['WuSlotComponent']
  };
}

// ============================================
// AI INTEGRATION (placeholder — ai.js loaded on demand)
// ============================================
function createWuAIService(...args) {
  throw new Error('[WuAngular] AI module not available. Install wu-framework AI extension.');
}

// Named exports for direct imports (e.g. import { createWuService } from 'wu-framework/adapters/angular')
export { createWuService, register, registerStandalone, registerElement, createWuSlotComponent, getWuSlotModuleConfig, getWuInstance, waitForWu };

// API pública del adapter
export const wuAngular = {
  register,
  registerStandalone,
  registerElement,
  createWuService,
  createWuSlotComponent,
  getWuSlotModuleConfig,
  createWuAIService,
  getWuInstance,
  waitForWu
};

export default wuAngular;
