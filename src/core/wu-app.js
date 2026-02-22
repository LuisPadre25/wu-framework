/**
 * 🎯 WU-APP: SIMPLIFIED API WRAPPER
 *
 * Wrapper simple para uso declarativo de microfrontends
 * Mantiene todo el core de wu-framework pero simplifica el uso
 */
import { logger } from './wu-logger.js';


export class WuApp {
  /**
   * @param {string} name - Nombre de la app
   * @param {Object} config - Configuración de la app
   * @param {string} config.url - URL donde está corriendo la app
   * @param {string} [config.container] - Selector del contenedor (opcional)
   * @param {Object} wu - Instancia de WuCore
   */
  constructor(name, config, wu) {
    this.name = name
    this.url = config.url
    this.container = config.container
    this.keepAlive = config.keepAlive || false
    this._wu = wu
    this._mounted = false
    this._autoInit = config.autoInit !== false // Default true

    // Auto-register app in wu-framework
    if (this._autoInit) {
      this._registerApp()
    }
  }

  /**
   * Registrar app en wu-framework
   * @private
   */
  _registerApp() {
    if (!this._wu.apps.has(this.name)) {
      this._wu.apps.set(this.name, {
        name: this.name,
        url: this.url,
        keepAlive: this.keepAlive,
        status: 'registered'
      })
      logger.debug(`📦 App registered: ${this.name} at ${this.url}`)
    }
  }

  /**
   * Montar la app en el contenedor
   * @param {string} [container] - Selector del contenedor (opcional, usa config.container si no se pasa)
   * @returns {Promise<void>}
   */
  async mount(container) {
    const targetContainer = container || this.container

    if (!targetContainer) {
      throw new Error(`Container not specified for app: ${this.name}`)
    }

    // Asegurar que wu-framework está inicializado
    if (!this._wu.isInitialized) {
      await this._wu.init({
        apps: [{ name: this.name, url: this.url }]
      })
    }

    // Montar usando wu-framework core
    await this._wu.mount(this.name, targetContainer)
    this._mounted = true

    return this
  }

  /**
   * Desmontar la app.
   * If keepAlive is configured, hides instead of destroying.
   *
   * @param {Object} [options] - { keepAlive, force }
   * @returns {Promise<WuApp>}
   */
  async unmount(options = {}) {
    if (!this._mounted && !this._wu.isHidden(this.name)) {
      logger.warn(`⚠️ App ${this.name} is not mounted`)
      return this
    }

    await this._wu.unmount(this.name, options)
    this._mounted = !this._wu.isHidden(this.name)

    return this
  }

  /**
   * Hide the app (keep-alive). Preserves all state for instant re-show.
   * @returns {Promise<WuApp>}
   */
  async hide() {
    if (!this._mounted) {
      logger.warn(`⚠️ App ${this.name} is not mounted`)
      return this
    }

    await this._wu.hide(this.name)
    this._mounted = false
    return this
  }

  /**
   * Show a hidden (keep-alive) app instantly.
   * @returns {Promise<WuApp>}
   */
  async show() {
    if (!this._wu.isHidden(this.name)) {
      logger.warn(`⚠️ App ${this.name} is not in keep-alive state`)
      return this
    }

    await this._wu.show(this.name)
    this._mounted = true
    return this
  }

  /**
   * Remontar la app (útil para recargas)
   * @param {string} [container] - Selector del contenedor
   * @returns {Promise<void>}
   */
  async remount(container) {
    await this.unmount({ force: true })
    await this.mount(container)
    return this
  }

  /**
   * Verificar si la app está montada
   * @returns {boolean}
   */
  get isMounted() {
    return this._mounted && this._wu.mounted?.has(this.name)
  }

  /**
   * Check if the app is in keep-alive (hidden) state
   * @returns {boolean}
   */
  get isHidden() {
    return this._wu.isHidden(this.name)
  }

  /**
   * Obtener información de la app
   * @returns {Object}
   */
  get info() {
    return {
      name: this.name,
      url: this.url,
      container: this.container,
      mounted: this.isMounted,
      status: this._wu.apps.get(this.name)?.status || 'unknown'
    }
  }

  /**
   * Recargar la app (limpiar cache y remontar)
   * @returns {Promise<void>}
   */
  async reload() {
    logger.debug(`🔄 Reloading app: ${this.name}`)

    await this.unmount()

    // Limpiar caches
    if (this._wu.loader?.clearCache) {
      this._wu.loader.clearCache(this.name)
    }
    if (this._wu.manifest?.clearCache) {
      this._wu.manifest.clearCache(this.name)
    }

    await this.mount()
    logger.debug(`✅ App reloaded: ${this.name}`)

    return this
  }

  /**
   * Verificar el estado de la app
   * @returns {Object}
   */
  async verify() {
    const container = document.querySelector(this.container)
    const hasShadowDOM = container?.shadowRoot !== null
    const hasContent = (container?.shadowRoot?.children?.length || 0) > 0

    return {
      name: this.name,
      mounted: this.isMounted,
      container: {
        found: !!container,
        selector: this.container,
        hasShadowDOM,
        hasContent
      },
      wu: {
        registered: this._wu.apps.has(this.name),
        mountedInWu: this._wu.mounted?.has(this.name)
      }
    }
  }

  /**
   * Shorthand para mount
   */
  async start(container) {
    return await this.mount(container)
  }

  /**
   * Shorthand para unmount
   */
  async stop() {
    return await this.unmount()
  }

  /**
   * Destruir la app completamente
   */
  async destroy() {
    await this.unmount({ force: true })
    this._wu.apps.delete(this.name)
    this._mounted = false
    logger.debug(`🗑️ App destroyed: ${this.name}`)
  }
}
