/**
 * WU-AI-ACTIONS: Action registry and executor
 *
 * Actions are capabilities that the LLM can invoke via tool_use / function_call.
 * Each action has:
 * - A handler function (sandboxed API, not raw wu access)
 * - JSON Schema parameters
 * - Permission requirements
 * - Optional confirmation flow
 *
 * Security: Actions receive a sandboxed API, not the full wu object.
 * The LLM cannot do anything the developer didn't explicitly expose.
 */

import { logger } from '../core/wu-logger.js';
import { validateParams, normalizeParameters, buildToolSchemas } from './wu-ai-schema.js';

export class WuAIActions {
  constructor({ eventBus, store, permissions }) {
    this._eventBus = eventBus;
    this._store = store;
    this._permissions = permissions;
    this._actions = new Map();
    this._executionLog = [];
    this._maxLogSize = 100;
    this._pendingConfirms = new Map(); // callId → { resolve, reject, timeout }
  }

  /**
   * Register an action that the LLM can invoke.
   *
   * @param {string} name - Action name (used in tool_call)
   * @param {object} config
   * @param {string} config.description - Human-readable description (sent to LLM)
   * @param {object} [config.parameters] - JSON Schema or shorthand for params
   * @param {Function} config.handler - async (params, sandboxedApi) => result
   * @param {boolean} [config.confirm=false] - Require user confirmation before executing
   * @param {string[]} [config.permissions=[]] - Required permission flags
   * @param {boolean} [config.dangerous=false] - Mark as dangerous in logs
   */
  register(name, config) {
    if (!config.handler || typeof config.handler !== 'function') {
      throw new Error(`[wu-ai] Action '${name}' must have a handler function`);
    }

    this._actions.set(name, {
      description: config.description || `Execute: ${name}`,
      parameters: normalizeParameters(config.parameters),
      handler: config.handler,
      confirm: config.confirm || false,
      permissions: config.permissions || [],
      dangerous: config.dangerous || false,
    });

    logger.wuDebug(`[wu-ai] Action registered: '${name}'${config.dangerous ? ' [DANGEROUS]' : ''}`);
  }

  /**
   * Unregister an action.
   */
  unregister(name) {
    this._actions.delete(name);
  }

  /**
   * Execute an action (called when LLM returns tool_call).
   *
   * @param {string} name - Action name
   * @param {object} params - Parameters from LLM
   * @param {object} [meta] - { traceId, depth, callId }
   * @returns {Promise<{ success: boolean, result?: any, reason?: string }>}
   */
  async execute(name, params, meta = {}) {
    const action = this._actions.get(name);
    if (!action) {
      return { success: false, reason: `Action '${name}' not registered` };
    }

    // 1. Check permissions
    for (const perm of action.permissions) {
      if (!this._permissions.check(perm)) {
        this._emitDenied(name, params, `Missing permission: ${perm}`);
        return { success: false, reason: `Permission denied: ${perm}` };
      }
    }

    // 2. Validate params
    const validation = validateParams(params || {}, action.parameters);
    if (!validation.valid) {
      return { success: false, reason: `Invalid params: ${validation.errors.join(', ')}` };
    }

    // 3. Confirmation (if required)
    if (action.confirm) {
      const confirmed = await this._requestConfirmation(name, params, meta.callId);
      if (!confirmed) {
        return { success: false, reason: 'User denied action' };
      }
    }

    // 4. Execute with sandboxed API
    try {
      if (action.dangerous) {
        logger.wuWarn(`[wu-ai] Executing DANGEROUS action: '${name}' with params: ${JSON.stringify(params)}`);
      }

      const api = this._createSandboxedApi(action.permissions);
      const result = await action.handler(params, api);

      // Audit log
      this._log(name, params, result, meta);

      // Emit success event
      this._eventBus.emit('ai:action:executed', {
        action: name,
        params,
        result,
        traceId: meta.traceId,
      }, { appName: 'wu-ai' });

      return { success: true, result };
    } catch (err) {
      this._eventBus.emit('ai:action:error', {
        action: name,
        params,
        error: err.message,
        traceId: meta.traceId,
      }, { appName: 'wu-ai' });

      return { success: false, reason: err.message };
    }
  }

  /**
   * Get tool schemas for the LLM (function calling format).
   */
  getToolSchemas() {
    return buildToolSchemas(this._actions);
  }

  /**
   * Check if an action is registered.
   */
  has(name) {
    return this._actions.has(name);
  }

  /**
   * Get registered action names.
   */
  getNames() {
    return [...this._actions.keys()];
  }

  /**
   * Get execution log.
   */
  getLog() {
    return [...this._executionLog];
  }

  /**
   * Confirm a pending tool call (called by developer/UI).
   */
  confirmTool(callId) {
    const pending = this._pendingConfirms.get(callId);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingConfirms.delete(callId);
      pending.resolve(true);
    }
  }

  /**
   * Reject a pending tool call.
   */
  rejectTool(callId) {
    const pending = this._pendingConfirms.get(callId);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingConfirms.delete(callId);
      pending.resolve(false);
    }
  }

  // ── Private: Sandboxed API ──

  _createSandboxedApi(requiredPermissions) {
    const api = {};
    const perms = new Set(requiredPermissions);

    // Store access (read)
    if (this._permissions.check('readStore')) {
      api.getState = (path) => this._store.get(path);
    }

    // Store access (write) — only if explicitly permitted
    if (this._permissions.check('writeStore') && perms.has('writeStore')) {
      api.setState = (path, value) => this._store.set(path, value);
    }

    // Event emission
    if (this._permissions.check('emitEvents')) {
      api.emit = (event, data) => this._eventBus.emit(event, data, { appName: 'wu-ai' });
    }

    return api;
  }

  // ── Private: Confirmation Flow ──

  _requestConfirmation(actionName, params, callId) {
    const id = callId || `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingConfirms.delete(id);
        resolve(false); // Timeout = deny
        logger.wuDebug(`[wu-ai] Confirmation timeout for action '${actionName}'`);
      }, 30000);

      this._pendingConfirms.set(id, { resolve, timeout: timeoutHandle });

      this._eventBus.emit('ai:tool:confirm', {
        callId: id,
        action: actionName,
        params,
        message: `AI wants to execute: ${actionName}`,
      }, { appName: 'wu-ai' });
    });
  }

  // ── Private: Logging ──

  _log(action, params, result, meta) {
    this._executionLog.push({
      action,
      params,
      result: typeof result === 'object' ? { ...result } : result,
      timestamp: Date.now(),
      traceId: meta.traceId,
    });

    if (this._executionLog.length > this._maxLogSize) {
      this._executionLog.shift();
    }
  }

  _emitDenied(action, params, reason) {
    this._eventBus.emit('ai:action:denied', { action, params, reason }, { appName: 'wu-ai' });
    logger.wuWarn(`[wu-ai] Action denied: '${action}' — ${reason}`);
  }

  getStats() {
    return {
      registeredActions: [...this._actions.keys()],
      executionLogSize: this._executionLog.length,
      pendingConfirmations: this._pendingConfirms.size,
    };
  }
}
