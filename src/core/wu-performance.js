/**
 * ⚡ WU-PERFORMANCE: MICROFRONTEND LIFECYCLE MONITORING
 *
 * Monitoreo de performance específico para operaciones del framework:
 * - Tiempos de mount/unmount
 * - Tiempos de carga de módulos
 * - Estadísticas por app
 */

import { logger } from './wu-logger.js';

export class WuPerformance {
  constructor() {
    this.metrics = new Map(); // appName -> metrics
    this.measurements = [];
    this.marks = new Map();

    this.config = {
      enabled: true,
      maxMeasurements: 1000
    };

    this.thresholds = {
      mount: 3000, // ms
      unmount: 1000, // ms
      load: 5000 // ms
    };

    logger.debug('[WuPerformance] ⚡ Framework performance monitoring initialized');
  }

  /**
   * 📊 START MEASURE: Iniciar medición
   * @param {string} name - Nombre de la medición
   * @param {string} appName - Nombre de la app (opcional)
   */
  startMeasure(name, appName = 'global') {
    const markName = `${appName}:${name}:start`;
    this.marks.set(markName, performance.now());

    logger.debug(`[WuPerformance] 📊 Measure started: ${markName}`);
  }

  /**
   * ⏹️ END MEASURE: Finalizar medición
   * @param {string} name - Nombre de la medición
   * @param {string} appName - Nombre de la app (opcional)
   * @returns {number} Duración en ms
   */
  endMeasure(name, appName = 'global') {
    const markName = `${appName}:${name}:start`;
    const startTime = this.marks.get(markName);

    if (!startTime) {
      // Puede ocurrir en React StrictMode (doble mount) — no es un error
      return 0;
    }

    const duration = performance.now() - startTime;
    this.marks.delete(markName);

    // Registrar medición
    this.recordMeasurement({
      name,
      appName,
      duration,
      timestamp: Date.now(),
      type: 'duration'
    });

    // Verificar threshold
    if (this.checkThreshold(name, duration)) {
      logger.warn(`[WuPerformance] ⚠️ Threshold exceeded for ${name}: ${duration.toFixed(2)}ms`);
    }

    logger.debug(`[WuPerformance] ⏹️ Measure ended: ${markName} (${duration.toFixed(2)}ms)`);
    return duration;
  }

  /**
   * 📝 RECORD MEASUREMENT: Registrar medición
   * @param {Object} measurement - Medición
   */
  recordMeasurement(measurement) {
    this.measurements.push(measurement);

    // Mantener tamaño máximo
    if (this.measurements.length > this.config.maxMeasurements) {
      this.measurements.shift();
    }

    // Actualizar métricas de la app
    if (!this.metrics.has(measurement.appName)) {
      this.metrics.set(measurement.appName, {
        appName: measurement.appName,
        measurements: [],
        stats: {}
      });
    }

    const appMetrics = this.metrics.get(measurement.appName);
    appMetrics.measurements.push(measurement);

    // Calcular estadísticas
    this.calculateStats(measurement.appName);
  }

  /**
   * 📊 CALCULATE STATS: Calcular estadísticas
   * @param {string} appName - Nombre de la app
   */
  calculateStats(appName) {
    const appMetrics = this.metrics.get(appName);
    if (!appMetrics) return;

    const measurements = appMetrics.measurements;
    if (measurements.length === 0) return;

    // Agrupar por tipo de medición
    const byType = {};
    measurements.forEach(m => {
      if (!byType[m.name]) byType[m.name] = [];
      byType[m.name].push(m.duration);
    });

    // Calcular estadísticas para cada tipo
    appMetrics.stats = {};
    Object.entries(byType).forEach(([name, durations]) => {
      appMetrics.stats[name] = {
        count: durations.length,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        last: durations[durations.length - 1]
      };
    });
  }

  /**
   * 🎯 CHECK THRESHOLD: Verificar si se excedió threshold
   * @param {string} name - Nombre de la medición
   * @param {number} value - Valor
   * @returns {boolean}
   */
  checkThreshold(name, value) {
    const threshold = this.thresholds[name];
    return threshold && value > threshold;
  }

  /**
   * 📊 GENERATE REPORT: Generar reporte de performance del framework
   * @returns {Object}
   */
  generateReport() {
    const report = {
      timestamp: Date.now(),
      totalMeasurements: this.measurements.length,
      apps: {}
    };

    // Agregar métricas por app
    for (const [appName, metrics] of this.metrics) {
      report.apps[appName] = {
        measurementCount: metrics.measurements.length,
        stats: metrics.stats
      };
    }

    return report;
  }

  /**
   * 📋 GET METRICS: Obtener métricas de una app
   * @param {string} appName - Nombre de la app
   * @returns {Object}
   */
  getMetrics(appName) {
    return this.metrics.get(appName) || null;
  }

  /**
   * 📊 GET ALL METRICS: Obtener todas las métricas
   * @returns {Object}
   */
  getAllMetrics() {
    const allMetrics = {};

    for (const [appName, metrics] of this.metrics) {
      allMetrics[appName] = metrics;
    }

    return allMetrics;
  }

  /**
   * 🧹 CLEAR METRICS: Limpiar métricas
   * @param {string} appName - Nombre de la app (opcional)
   */
  clearMetrics(appName) {
    if (appName) {
      this.metrics.delete(appName);
      this.measurements = this.measurements.filter(m => m.appName !== appName);
    } else {
      this.metrics.clear();
      this.measurements = [];
    }

    logger.debug(`[WuPerformance] 🧹 Metrics cleared${appName ? ` for ${appName}` : ''}`);
  }

  /**
   * ⚙️ CONFIGURE: Configurar performance monitor
   * @param {Object} config - Nueva configuración
   */
  configure(config) {
    this.config = {
      ...this.config,
      ...config
    };

    if (config.thresholds) {
      this.thresholds = {
        ...this.thresholds,
        ...config.thresholds
      };
    }
  }
}
