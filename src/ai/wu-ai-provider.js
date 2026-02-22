/**
 * WU-AI-PROVIDER: BYOL (Bring Your Own LLM) provider system
 *
 * Pure fetch(), zero dependencies. Adapters normalize request/response
 * across OpenAI, Anthropic, Ollama, and custom providers.
 *
 * Internal normalized format:
 *   Request:  { role, content, tool_calls?, tool_call_id? }
 *   Response: { content, tool_calls?, usage? }
 */

import { logger } from '../core/wu-logger.js';

// ─── Normalized types (internal) ─────────────────────────────────
//
// Message: { role: 'system'|'user'|'assistant'|'tool', content: string,
//            tool_calls?: ToolCall[], tool_call_id?: string }
//
// ToolCall: { id: string, name: string, arguments: object }
//
// Response: { content: string, tool_calls?: ToolCall[], usage?: { prompt_tokens, completion_tokens } }
//
// StreamChunk: { type: 'text'|'tool_call'|'done'|'error', content?: string,
//                tool_call?: ToolCall, usage?: object, error?: string }

// ─── Base Adapter ────────────────────────────────────────────────

class BaseAdapter {
  constructor(config = {}) {
    this.model = config.model || '';
  }

  /** Format messages + options into provider-specific request body */
  formatRequest(/* messages, options */) {
    throw new Error('Adapter must implement formatRequest()');
  }

  /** Parse provider response into normalized Response */
  parseResponse(/* rawData */) {
    throw new Error('Adapter must implement parseResponse()');
  }

  /** Parse a streaming SSE line into a StreamChunk (or null to skip) */
  parseStreamChunk(/* line */) {
    throw new Error('Adapter must implement parseStreamChunk()');
  }

  /** Get required headers for the provider */
  getHeaders(/* config */) {
    return { 'Content-Type': 'application/json' };
  }
}

// ─── OpenAI Adapter ──────────────────────────────────────────────

class OpenAIAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.model = config.model || 'gpt-4o';
  }

  getHeaders(config) {
    const h = { 'Content-Type': 'application/json' };
    if (config.apiKey) h['Authorization'] = `Bearer ${config.apiKey}`;
    return h;
  }

  formatRequest(messages, options = {}) {
    const body = {
      model: options.model || this.model,
      messages: messages.map(m => {
        const msg = { role: m.role, content: m.content };
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.tool_calls) msg.tool_calls = m.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
        return msg;
      }),
    };
    if (options.tools?.length) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.stream) body.stream = true;

    // Structured output / JSON mode
    if (options.responseFormat) {
      const rf = options.responseFormat;
      if (rf === 'json' || rf?.type === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (rf?.type === 'json_schema') {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: rf.name || 'response',
            schema: rf.schema,
            strict: rf.strict !== false,
          },
        };
      }
    }

    return body;
  }

  parseResponse(data) {
    const choice = data.choices?.[0];
    if (!choice) return { content: '', tool_calls: [], usage: data.usage };

    const msg = choice.message || {};
    const toolCalls = (msg.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: this._safeParseArgs(tc.function?.arguments),
    }));

    return {
      content: msg.content || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
      } : undefined,
    };
  }

  parseStreamChunk(line) {
    if (!line.startsWith('data: ')) return null;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') return { type: 'done' };

    try {
      const data = JSON.parse(raw);
      const delta = data.choices?.[0]?.delta;
      if (!delta) return null;

      if (delta.tool_calls?.length) {
        const tc = delta.tool_calls[0];
        return {
          type: 'tool_call_delta',
          index: tc.index,
          id: tc.id,
          name: tc.function?.name,
          argumentsDelta: tc.function?.arguments || '',
        };
      }

      if (delta.content) {
        return { type: 'text', content: delta.content };
      }

      if (data.usage) {
        return { type: 'usage', usage: data.usage };
      }

      return null;
    } catch {
      return null;
    }
  }

  _safeParseArgs(str) {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
  }
}

// ─── Anthropic Adapter ───────────────────────────────────────────

class AnthropicAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.model = config.model || 'claude-sonnet-4-5-20250929';
  }

  getHeaders(config) {
    const h = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      h['x-api-key'] = config.apiKey;
      h['anthropic-version'] = '2023-06-01';
    }
    return h;
  }

  formatRequest(messages, options = {}) {
    // Anthropic separates system from messages
    const systemMsgs = messages.filter(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');

    const body = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || 4096,
      messages: otherMsgs.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content,
            }],
          };
        }
        if (m.tool_calls) {
          return {
            role: 'assistant',
            content: m.tool_calls.map(tc => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
    };

    if (systemMsgs.length) {
      body.system = systemMsgs.map(m => m.content).join('\n\n');
    }

    // Structured output / JSON mode (Anthropic has no native support)
    // Strategy: augment system prompt + prefill assistant turn with '{'
    if (options.responseFormat) {
      const rf = options.responseFormat;
      const jsonInstruction = '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.';

      if (rf === 'json' || rf?.type === 'json_object') {
        body.system = (body.system || '') + jsonInstruction;
      } else if (rf?.type === 'json_schema') {
        const schemaStr = JSON.stringify(rf.schema, null, 2);
        body.system = (body.system || '') +
          jsonInstruction +
          `\n\nYour response MUST conform to this JSON schema:\n${schemaStr}`;
      }

      // Prefill assistant message with '{' to force JSON output
      body.messages.push({ role: 'assistant', content: '{' });
    }

    if (options.tools?.length) {
      body.tools = options.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.stream) body.stream = true;
    return body;
  }

  parseResponse(data) {
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use');

    const content = textBlocks.map(b => b.text).join('');
    const toolCalls = toolBlocks.map(b => ({
      id: b.id,
      name: b.name,
      arguments: b.input || {},
    }));

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
      } : undefined,
    };
  }

  parseStreamChunk(line) {
    if (!line.startsWith('data: ')) return null;
    const raw = line.slice(6).trim();

    try {
      const data = JSON.parse(raw);

      if (data.type === 'content_block_delta') {
        if (data.delta?.type === 'text_delta') {
          return { type: 'text', content: data.delta.text };
        }
        if (data.delta?.type === 'input_json_delta') {
          return { type: 'tool_call_delta', argumentsDelta: data.delta.partial_json || '' };
        }
      }

      if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
        return {
          type: 'tool_call_start',
          id: data.content_block.id,
          name: data.content_block.name,
        };
      }

      if (data.type === 'message_delta' && data.usage) {
        return {
          type: 'usage',
          usage: { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens },
        };
      }

      if (data.type === 'message_stop') {
        return { type: 'done' };
      }

      return null;
    } catch {
      return null;
    }
  }
}

// ─── Ollama Adapter ──────────────────────────────────────────────

class OllamaAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.model = config.model || 'llama3';
  }

  getHeaders() {
    return { 'Content-Type': 'application/json' };
  }

  formatRequest(messages, options = {}) {
    const body = {
      model: options.model || this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options.tools?.length) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (options.temperature !== undefined) body.options = { temperature: options.temperature };
    if (options.stream !== undefined) body.stream = options.stream;

    // Structured output / JSON mode
    if (options.responseFormat) {
      const rf = options.responseFormat;
      if (rf === 'json' || rf?.type === 'json_object') {
        body.format = 'json';
      } else if (rf?.type === 'json_schema') {
        body.format = rf.schema;
      }
    }

    return body;
  }

  parseResponse(data) {
    const msg = data.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc, i) => ({
      id: `ollama_${i}_${Date.now()}`,
      name: tc.function?.name,
      arguments: tc.function?.arguments || {},
    }));

    return {
      content: msg.content || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.eval_count ? {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
      } : undefined,
    };
  }

  parseStreamChunk(line) {
    try {
      const data = JSON.parse(line);
      if (data.done) return { type: 'done' };
      if (data.message?.content) return { type: 'text', content: data.message.content };
      return null;
    } catch {
      return null;
    }
  }
}

// ─── Custom Adapter (user-provided send/stream) ──────────────────

class CustomAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this._sendFn = config.send || null;
    this._streamFn = config.stream || null;
  }

  /** Custom adapters bypass formatRequest/parseResponse */
  get isCustom() { return true; }
}

// ─── Provider Registry ───────────────────────────────────────────

const BUILTIN_ADAPTERS = {
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
  ollama: OllamaAdapter,
};

// ─── Main Provider Class ─────────────────────────────────────────

export class WuAIProvider {
  constructor() {
    this._providers = new Map();
    this._active = null;
    this._activeName = null;
    this._activeConfig = {};
    this._retryConfig = { maxRetries: 3, baseDelayMs: 1000 };
  }

  /**
   * Register and activate a provider.
   *
   * @param {string} name - Provider name or built-in adapter ('openai', 'anthropic', 'ollama', 'custom')
   * @param {object} config - Provider configuration
   * @param {string} [config.endpoint] - API endpoint URL
   * @param {string} [config.adapter] - Built-in adapter name (if name is custom)
   * @param {string} [config.apiKey] - API key (WARNING: exposed in browser)
   * @param {string} [config.model] - Model name
   * @param {Function} [config.send] - Custom send function
   * @param {Function} [config.stream] - Custom stream generator function
   */
  register(name, config = {}) {
    const adapterName = config.adapter || name;
    const AdapterClass = BUILTIN_ADAPTERS[adapterName];

    let adapter;
    if (config.send || config.stream) {
      adapter = new CustomAdapter(config);
    } else if (AdapterClass) {
      adapter = new AdapterClass(config);
    } else {
      throw new Error(
        `[wu-ai] Unknown adapter '${adapterName}'. ` +
        `Available: ${Object.keys(BUILTIN_ADAPTERS).join(', ')}, or provide custom send/stream.`
      );
    }

    this._providers.set(name, { adapter, config });

    // Auto-activate if first provider or explicitly active
    if (!this._active || config.active !== false) {
      this._active = adapter;
      this._activeName = name;
      this._activeConfig = config;
    }

    logger.wuInfo(`[wu-ai] Provider registered: '${name}' (adapter: ${adapterName})`);
  }

  /**
   * Switch active provider.
   */
  use(name) {
    const entry = this._providers.get(name);
    if (!entry) throw new Error(`[wu-ai] Provider '${name}' not registered`);
    this._active = entry.adapter;
    this._activeName = name;
    this._activeConfig = entry.config;
  }

  /**
   * Send a non-streaming request.
   *
   * @param {Array} messages - Normalized messages
   * @param {object} [options] - { tools, temperature, maxTokens, signal }
   * @returns {Promise<{ content: string, tool_calls?: Array, usage?: object }>}
   */
  async send(messages, options = {}) {
    const { adapter, config } = this._resolveProvider(options.provider);

    // Custom adapter: call user function directly
    if (adapter.isCustom && adapter._sendFn) {
      return adapter._sendFn(messages, options);
    }

    const endpoint = config.endpoint || config.baseUrl;
    if (!endpoint) {
      throw new Error('[wu-ai] No endpoint configured. Set config.endpoint or config.baseUrl.');
    }

    const url = this._resolveUrl(endpoint);
    const body = adapter.formatRequest(messages, { ...options, stream: false });
    const headers = adapter.getHeaders(config);

    const response = await this._fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    const data = await response.json();
    const result = adapter.parseResponse(data);

    // Anthropic prefill compensation: we prepended '{' to force JSON,
    // so the response content is the continuation — restore the full JSON
    if (adapter instanceof AnthropicAdapter && options.responseFormat && result.content) {
      result.content = '{' + result.content;
    }

    // Validate JSON when responseFormat was requested
    if (options.responseFormat && result.content) {
      try {
        result.parsed = JSON.parse(result.content);
      } catch {
        result.parseError = 'Response is not valid JSON';
        logger.wuDebug('[wu-ai] responseFormat requested but LLM returned invalid JSON');
      }
    }

    return result;
  }

  /**
   * Send a streaming request. Returns an async generator of chunks.
   *
   * @param {Array} messages - Normalized messages
   * @param {object} [options] - { tools, temperature, maxTokens, signal }
   * @yields {StreamChunk}
   */
  async *stream(messages, options = {}) {
    const { adapter, config } = this._resolveProvider(options.provider);

    // Custom adapter: call user generator directly
    if (adapter.isCustom && adapter._streamFn) {
      yield* adapter._streamFn(messages, options);
      return;
    }

    const endpoint = config.endpoint || config.baseUrl;
    if (!endpoint) {
      throw new Error('[wu-ai] No endpoint configured. Set config.endpoint or config.baseUrl.');
    }

    const url = this._resolveUrl(endpoint);
    const body = adapter.formatRequest(messages, { ...options, stream: true });
    const headers = adapter.getHeaders(config);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`[wu-ai] Stream request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Anthropic prefill compensation for streaming:
    // emit the '{' we used as prefill before the first real chunk
    let needsPrefill = adapter instanceof AnthropicAdapter && !!options.responseFormat;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = adapter.parseStreamChunk(trimmed);
          if (chunk) {
            if (needsPrefill && chunk.type === 'text') {
              chunk.content = '{' + chunk.content;
              needsPrefill = false;
            }
            yield chunk;
          }
          if (chunk?.type === 'done') return;
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const chunk = adapter.parseStreamChunk(buffer.trim());
        if (chunk) yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Retry logic ──

  async _fetchWithRetry(url, options) {
    let lastError;
    for (let attempt = 0; attempt <= this._retryConfig.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Only retry on 429 (rate limit) and 5xx
        if (response.ok) return response;

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          if (attempt < this._retryConfig.maxRetries) {
            const delay = this._retryConfig.baseDelayMs * Math.pow(2, attempt);
            logger.wuDebug(`[wu-ai] Retry ${attempt + 1}/${this._retryConfig.maxRetries} in ${delay}ms (${response.status})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }

        // 4xx (except 429) — don't retry, fail immediately
        const clientError = new Error(`[wu-ai] Request failed: ${response.status} ${response.statusText}`);
        clientError._noRetry = true;
        throw clientError;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err._noRetry) throw err; // 4xx — don't retry
        lastError = err;
        if (attempt < this._retryConfig.maxRetries) {
          const delay = this._retryConfig.baseDelayMs * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }
    throw lastError;
  }

  // ── Helpers ──

  _resolveUrl(endpoint) {
    // Relative URLs (e.g., '/api/ai/chat') resolve against current origin
    if (endpoint.startsWith('/')) {
      return typeof window !== 'undefined'
        ? `${window.location.origin}${endpoint}`
        : endpoint;
    }
    return endpoint;
  }

  /**
   * Resolve which provider/adapter to use for a request.
   * Supports per-call selection: options.provider = 'anthropic'
   *
   * @param {string} [providerName] - Optional provider name override
   * @returns {{ adapter: BaseAdapter, config: object }}
   */
  _resolveProvider(providerName) {
    if (providerName) {
      const entry = this._providers.get(providerName);
      if (!entry) {
        throw new Error(`[wu-ai] Provider '${providerName}' not registered. Available: ${[...this._providers.keys()].join(', ')}`);
      }
      return { adapter: entry.adapter, config: entry.config };
    }
    this._ensureActive();
    return { adapter: this._active, config: this._activeConfig };
  }

  _ensureActive() {
    if (!this._active) {
      throw new Error(
        '[wu-ai] No provider configured. Call wu.ai.provider("name", { endpoint, adapter }) first.'
      );
    }
  }

  configureRetry(config) {
    if (config.maxRetries !== undefined) this._retryConfig.maxRetries = config.maxRetries;
    if (config.baseDelayMs !== undefined) this._retryConfig.baseDelayMs = config.baseDelayMs;
  }

  getActiveProvider() {
    return this._activeName;
  }

  getStats() {
    return {
      activeProvider: this._activeName,
      registeredProviders: [...this._providers.keys()],
    };
  }
}
