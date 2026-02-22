/**
 * WU-MCP Bridge (Browser Side)
 *
 * Connects to the wu-mcp-server via WebSocket and executes
 * commands using wu.* APIs. This is the "eyes and hands" of
 * the MCP server inside the browser.
 *
 * Security:
 *   - Optional auth token sent on first message (handshake)
 *   - All state/event/mount operations check wu.ai permissions
 *   - Mutating operations emit audit events
 *   - Read-only operations (status, list_apps, snapshot, console, network) are unrestricted
 *
 * @example
 * // Connect with auth token
 * wu.mcp.connect('ws://localhost:19100', { token: 'my-secret' });
 *
 * // Connect without auth (development only)
 * wu.mcp.connect();
 */

import {
  ensureInterceptors,
  networkLog,
  consoleLog,
  captureScreenshot,
  buildA11yTree,
  clickElement,
  typeIntoElement,
  getFilteredNetwork,
  getFilteredConsole,
} from '../ai/wu-ai-browser-primitives.js';
import { logger } from './wu-logger.js';

/**
 * Create the MCP bridge for a Wu instance.
 *
 * @param {object} wu - The Wu Framework instance (window.wu)
 * @returns {object} Bridge API: { connect, disconnect, isConnected }
 */
export function createMcpBridge(wu) {
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let authenticated = false;
  let authToken = null;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY = 2000;

  // Event log for wu_list_events
  const eventLog = [];
  const MAX_EVENT_LOG = 200;

  // Capture events for history
  if (wu.eventBus) {
    wu.eventBus.on('*', (event) => {
      eventLog.push({
        name: event.name,
        data: event.data,
        timestamp: event.timestamp || Date.now(),
        source: event.source || 'unknown',
      });
      if (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
    });
  }

  // Install shared interceptors (idempotent — safe if wu-ai-browser already did it)
  ensureInterceptors();

  // ── Permission helpers ──

  /**
   * Check a permission flag via wu.ai.permissions if available.
   * Falls back to deny if wu.ai is not initialized.
   */
  function _checkPermission(perm) {
    if (wu.ai && wu.ai.permissions) {
      return wu.ai.permissions.check(perm);
    }
    // If AI module not initialized, deny write operations, allow reads
    const readPerms = ['readStore', 'executeActions'];
    return readPerms.includes(perm);
  }

  /**
   * Emit an audit event for bridge operations.
   */
  function _audit(operation, params, result) {
    if (wu.eventBus) {
      wu.eventBus.emit('mcp:bridge:operation', {
        operation,
        params,
        result: result?.error ? { error: result.error } : { success: true },
        timestamp: Date.now(),
      }, { appName: 'wu-mcp-bridge' });
    }
  }

  // ── Command handlers ──

  const handlers = {
    // ── Read-only operations (no permission gates) ──

    status() {
      return {
        connected: true,
        framework: 'wu-framework',
        apps: _getAppList(),
        storeKeys: wu.store ? Object.keys(wu.store.get('') || {}) : [],
        actionsCount: wu.ai ? wu.ai.tools().length : 0,
        eventLogSize: eventLog.length,
      };
    },

    list_apps() {
      return _getAppList();
    },

    list_events({ limit = 20 }) {
      return eventLog.slice(-limit);
    },

    list_actions() {
      if (!wu.ai) return { actions: [], note: 'wu.ai not initialized' };
      const tools = wu.ai.tools();
      return { actions: tools, count: tools.length };
    },

    snapshot({ appName }) {
      try {
        const target = appName
          ? document.querySelector(`[data-wu-app="${appName}"]`) || document.querySelector(`#wu-app-${appName}`)
          : document.body;

        if (!target) return { error: `App "${appName}" not found in DOM` };

        return {
          app: appName || '(page)',
          snapshot: buildA11yTree(target, 0, 5),
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err.message };
      }
    },

    console({ level = 'all', limit = 50 }) {
      return getFilteredConsole(level, limit);
    },

    async screenshot({ selector, quality = 0.8 }) {
      const result = await captureScreenshot(selector, quality);
      if (!result.error) result.timestamp = Date.now();
      return result;
    },

    network({ method, status, limit = 50 }) {
      return getFilteredNetwork(method, status, limit);
    },

    // ── Permission-gated operations ──

    get_state({ path }) {
      if (!wu.store) return { error: 'wu.store not available' };
      if (!_checkPermission('readStore')) {
        return { error: 'Permission denied: readStore is disabled' };
      }
      const value = wu.store.get(path || '');
      return { path: path || '(root)', value };
    },

    set_state({ path, value }) {
      if (!wu.store) return { error: 'wu.store not available' };
      if (!path) return { error: 'path is required' };
      if (!_checkPermission('writeStore')) {
        _audit('set_state', { path }, { error: 'Permission denied' });
        return { error: 'Permission denied: writeStore is disabled' };
      }
      wu.store.set(path, value);
      _audit('set_state', { path, value }, { success: true });
      return { path, value, updated: true };
    },

    emit_event({ event, data }) {
      if (!wu.eventBus) return { error: 'wu.eventBus not available' };
      if (!event) return { error: 'event name is required' };
      if (!_checkPermission('emitEvents')) {
        _audit('emit_event', { event }, { error: 'Permission denied' });
        return { error: 'Permission denied: emitEvents is disabled' };
      }
      wu.eventBus.emit(event, data, { appName: 'wu-mcp-bridge' });
      _audit('emit_event', { event, data }, { success: true });
      return { emitted: event, data };
    },

    navigate({ route }) {
      if (!route) return { error: 'Route is required' };
      if (!_checkPermission('emitEvents')) {
        _audit('navigate', { route }, { error: 'Permission denied: emitEvents' });
        return { error: 'Permission denied: emitEvents is disabled' };
      }
      if (wu.eventBus) {
        wu.eventBus.emit('shell:navigate', { route }, { appName: 'wu-mcp-bridge' });
      }
      if (wu.store && _checkPermission('writeStore')) {
        wu.store.set('currentPath', route);
      }
      _audit('navigate', { route }, { success: true });
      return { navigated: route };
    },

    mount_app({ appName, container }) {
      if (!appName) return { error: 'appName is required' };
      if (!_checkPermission('modifyDOM')) {
        _audit('mount_app', { appName }, { error: 'Permission denied' });
        return { error: 'Permission denied: modifyDOM is disabled' };
      }
      try {
        if (wu.mount) {
          wu.mount(appName, container);
          _audit('mount_app', { appName, container }, { success: true });
          return { mounted: appName, container };
        }
        return { error: 'wu.mount not available' };
      } catch (err) {
        return { error: err.message };
      }
    },

    unmount_app({ appName }) {
      if (!appName) return { error: 'appName is required' };
      if (!_checkPermission('modifyDOM')) {
        _audit('unmount_app', { appName }, { error: 'Permission denied' });
        return { error: 'Permission denied: modifyDOM is disabled' };
      }
      try {
        if (wu.unmount) {
          wu.unmount(appName);
          _audit('unmount_app', { appName }, { success: true });
          return { unmounted: appName };
        }
        return { error: 'wu.unmount not available' };
      } catch (err) {
        return { error: err.message };
      }
    },

    click({ selector, text }) {
      if (!_checkPermission('modifyDOM')) {
        return { error: 'Permission denied: modifyDOM is disabled' };
      }
      const result = clickElement(selector, text);
      _audit('click', { selector, text }, result);
      return result;
    },

    type({ selector, text, clear = false, submit = false }) {
      if (!_checkPermission('modifyDOM')) {
        return { error: 'Permission denied: modifyDOM is disabled' };
      }
      const result = typeIntoElement(selector, text, { clear, submit });
      _audit('type', { selector, textLength: text?.length }, result);
      return result;
    },

    async execute_action({ action, params }) {
      if (!wu.ai) return { error: 'wu.ai not available' };
      if (!action) return { error: 'action name is required' };

      try {
        // Execute through public API (respects permissions, validation, audit)
        const result = await wu.ai.execute(action, params || {});
        return { action, ...result };
      } catch (err) {
        return { error: err.message };
      }
    },
  };

  // ── WebSocket connection ──

  function connect(url = 'ws://localhost:19100', options = {}) {
    if (ws && ws.readyState <= 1) {
      logger.warn('[wu-mcp-bridge] Already connected or connecting');
      return;
    }

    authToken = options.token || null;
    authenticated = !authToken; // No token = auto-authenticated (dev mode)

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        logger.debug('[wu-mcp-bridge] Connected to wu-mcp-server');
        reconnectAttempts = 0;

        // Send auth handshake if token provided
        if (authToken) {
          ws.send(JSON.stringify({
            type: 'auth',
            token: authToken,
          }));
        }
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle auth response
          if (msg.type === 'auth_result') {
            authenticated = msg.success === true;
            if (!authenticated) {
              console.error('[wu-mcp-bridge] Authentication failed:', msg.reason || 'Invalid token');
              disconnect();
            } else {
              logger.debug('[wu-mcp-bridge] Authenticated successfully');
            }
            return;
          }

          // Reject commands if not authenticated
          if (!authenticated) {
            if (msg.id) {
              _respond(msg.id, null, 'Not authenticated. Send auth token first.');
            }
            return;
          }

          const { id, command, params } = msg;

          if (!id || !command) {
            logger.warn('[wu-mcp-bridge] Invalid message:', msg);
            return;
          }

          const handler = handlers[command];
          if (!handler) {
            _respond(id, null, `Unknown command: ${command}`);
            return;
          }

          try {
            const result = await handler(params || {});
            _respond(id, result);
          } catch (err) {
            _respond(id, null, err.message);
          }
        } catch (err) {
          console.error('[wu-mcp-bridge] Failed to handle message:', err);
        }
      };

      ws.onclose = () => {
        logger.debug('[wu-mcp-bridge] Disconnected');
        ws = null;
        authenticated = false;
        _scheduleReconnect(url, options);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch (err) {
      console.error('[wu-mcp-bridge] Connection failed:', err.message);
      _scheduleReconnect(url, options);
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    if (ws) {
      ws.close();
      ws = null;
    }
    authenticated = false;
  }

  function isConnected() {
    return ws !== null && ws.readyState === 1 && authenticated;
  }

  // ── Private helpers ──

  function _respond(id, result, error) {
    if (!ws || ws.readyState !== 1) return;
    const msg = error ? { id, error } : { id, result };
    ws.send(JSON.stringify(msg));
  }

  function _scheduleReconnect(url, options) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectAttempts++;
    const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5);
    reconnectTimer = setTimeout(() => connect(url, options), delay);
  }

  function _getAppList() {
    const apps = [];

    if (wu._apps) {
      for (const [name, app] of Object.entries(wu._apps)) {
        apps.push({
          name,
          mounted: app.mounted || app.isMounted || false,
          url: app.url || app.info?.url || '',
          status: app.status || app.info?.status || 'unknown',
        });
      }
    }

    // Fallback: scan DOM for wu-app elements
    if (apps.length === 0) {
      document.querySelectorAll('[data-wu-app]').forEach((el) => {
        apps.push({
          name: el.getAttribute('data-wu-app'),
          mounted: true,
          container: `#${el.id || '(no-id)'}`,
        });
      });
    }

    return apps;
  }

  return { connect, disconnect, isConnected };
}
