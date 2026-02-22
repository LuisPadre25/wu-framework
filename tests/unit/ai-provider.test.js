import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuAIProvider } from '../../src/ai/wu-ai-provider.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn(),
  },
}));

// ─── Fixtures: trimmed to essential fields ───────────────────────

const OPENAI_RESPONSE = {
  choices: [{
    message: {
      content: 'Hello from OpenAI',
      tool_calls: [{
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Paris"}',
        },
      }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
};

const OPENAI_RESPONSE_PLAIN = {
  choices: [{ message: { content: 'Just text, no tools' } }],
  usage: { prompt_tokens: 5, completion_tokens: 8 },
};

const ANTHROPIC_RESPONSE = {
  content: [
    { type: 'text', text: 'Hello from Anthropic' },
    { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: { location: 'Paris' } },
  ],
  usage: { input_tokens: 15, output_tokens: 25 },
};

const ANTHROPIC_RESPONSE_PLAIN = {
  content: [{ type: 'text', text: 'Just text response' }],
  usage: { input_tokens: 5, output_tokens: 10 },
};

const OLLAMA_RESPONSE = {
  message: { role: 'assistant', content: 'Hello from Ollama' },
  prompt_eval_count: 12,
  eval_count: 18,
};

const OLLAMA_RESPONSE_WITH_TOOLS = {
  message: {
    role: 'assistant',
    content: '',
    tool_calls: [{
      function: { name: 'get_weather', arguments: { location: 'Paris' } },
    }],
  },
  prompt_eval_count: 12,
  eval_count: 18,
};

// ─── Helper: build a mock fetch Response ─────────────────────────

function mockFetchJson(fixture) {
  return vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(fixture),
  }));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('WuAIProvider', () => {
  let provider;
  let originalFetch;

  beforeEach(() => {
    provider = new WuAIProvider();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ═══════════════════════════════════════════════════════════════
  // Registration & Switching
  // ═══════════════════════════════════════════════════════════════

  describe('Registration & switching', () => {
    it('should register an OpenAI provider', () => {
      provider.register('openai', { endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'sk-test' });
      expect(provider.getActiveProvider()).toBe('openai');
      expect(provider.getStats().registeredProviders).toContain('openai');
    });

    it('should register an Anthropic provider', () => {
      provider.register('anthropic', { endpoint: 'https://api.anthropic.com/v1/messages', apiKey: 'sk-ant-test' });
      expect(provider.getActiveProvider()).toBe('anthropic');
      expect(provider.getStats().registeredProviders).toContain('anthropic');
    });

    it('should register an Ollama provider', () => {
      provider.register('ollama', { endpoint: 'http://localhost:11434/api/chat' });
      expect(provider.getActiveProvider()).toBe('ollama');
      expect(provider.getStats().registeredProviders).toContain('ollama');
    });

    it('should switch active provider with use()', () => {
      provider.register('openai', { endpoint: 'https://api.openai.com/v1/chat/completions' });
      provider.register('anthropic', { endpoint: 'https://api.anthropic.com/v1/messages' });

      provider.use('openai');
      expect(provider.getActiveProvider()).toBe('openai');

      provider.use('anthropic');
      expect(provider.getActiveProvider()).toBe('anthropic');
    });

    it('should throw on unknown adapter', () => {
      expect(() => provider.register('mystery', { adapter: 'grok' }))
        .toThrow(/Unknown adapter 'grok'/);
    });

    it('should auto-activate the first registered provider', () => {
      provider.register('openai', { endpoint: 'https://api.openai.com/v1/chat/completions' });
      provider.register('anthropic', { endpoint: 'https://api.anthropic.com/v1/messages', active: false });

      // Second provider has active:false, but the code only preserves the first
      // if config.active !== false. So the first stays active.
      // Actually, looking at the code: if (!this._active || config.active !== false)
      // Since active is explicitly false, the second won't override.
      expect(provider.getActiveProvider()).toBe('openai');
    });

    it('should throw when use() is called with unregistered name', () => {
      expect(() => provider.use('nonexistent'))
        .toThrow(/Provider 'nonexistent' not registered/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // OpenAI Adapter
  // ═══════════════════════════════════════════════════════════════

  describe('OpenAI Adapter', () => {
    const MESSAGES = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];

    const TOOLS = [{
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    }];

    beforeEach(() => {
      provider.register('openai', {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
    });

    describe('formatRequest', () => {
      it('should produce correct body structure with messages, tools, temperature', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, {
          tools: TOOLS,
          temperature: 0.7,
          maxTokens: 1000,
        });

        expect(body.model).toBe('gpt-4o');
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
        expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
        expect(body.tools).toHaveLength(1);
        expect(body.tools[0].type).toBe('function');
        expect(body.tools[0].function.name).toBe('get_weather');
        expect(body.temperature).toBe(0.7);
        expect(body.max_tokens).toBe(1000);
      });

      it('should map tool_calls on assistant messages to OpenAI format', () => {
        const { adapter } = provider._resolveProvider();
        const msgs = [{
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'tc_1', name: 'get_weather', arguments: { location: 'Paris' } }],
        }];

        const body = adapter.formatRequest(msgs);
        const tc = body.messages[0].tool_calls[0];
        expect(tc.id).toBe('tc_1');
        expect(tc.type).toBe('function');
        expect(tc.function.name).toBe('get_weather');
        expect(tc.function.arguments).toBe('{"location":"Paris"}');
      });

      it('should pass through tool_call_id on tool result messages', () => {
        const { adapter } = provider._resolveProvider();
        const msgs = [{ role: 'tool', content: '{"temp":22}', tool_call_id: 'tc_1' }];

        const body = adapter.formatRequest(msgs);
        expect(body.messages[0].tool_call_id).toBe('tc_1');
      });
    });

    describe('parseResponse', () => {
      it('should parse content and tool_calls from OpenAI response', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(OPENAI_RESPONSE);

        expect(result.content).toBe('Hello from OpenAI');
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls[0].id).toBe('call_abc123');
        expect(result.tool_calls[0].name).toBe('get_weather');
        expect(result.tool_calls[0].arguments).toEqual({ location: 'Paris' });
        expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
      });

      it('should return empty content when choices array is empty', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse({ choices: [] });
        expect(result.content).toBe('');
        expect(result.tool_calls).toEqual([]);
      });

      it('should return undefined tool_calls when none present', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(OPENAI_RESPONSE_PLAIN);
        expect(result.content).toBe('Just text, no tools');
        expect(result.tool_calls).toBeUndefined();
      });
    });

    describe('parseStreamChunk', () => {
      it('should parse text delta', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
        const chunk = adapter.parseStreamChunk(line);

        expect(chunk).toEqual({ type: 'text', content: 'Hello' });
      });

      it('should parse tool_call delta', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"get_weather","arguments":"{\\\"loc"}}]}}]}';
        const chunk = adapter.parseStreamChunk(line);

        expect(chunk.type).toBe('tool_call_delta');
        expect(chunk.id).toBe('call_x');
        expect(chunk.name).toBe('get_weather');
        expect(chunk.argumentsDelta).toBe('{"loc');
      });

      it('should parse [DONE] signal', () => {
        const { adapter } = provider._resolveProvider();
        const chunk = adapter.parseStreamChunk('data: [DONE]');
        expect(chunk).toEqual({ type: 'done' });
      });

      it('should return null for non-data lines', () => {
        const { adapter } = provider._resolveProvider();
        expect(adapter.parseStreamChunk('')).toBeNull();
        expect(adapter.parseStreamChunk('event: ping')).toBeNull();
      });

      it('should return null for malformed JSON', () => {
        const { adapter } = provider._resolveProvider();
        expect(adapter.parseStreamChunk('data: {invalid}')).toBeNull();
      });
    });

    describe('responseFormat', () => {
      it('should add response_format json_object for "json"', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { responseFormat: 'json' });
        expect(body.response_format).toEqual({ type: 'json_object' });
      });

      it('should add response_format json_object for { type: "json_object" }', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_object' },
        });
        expect(body.response_format).toEqual({ type: 'json_object' });
      });

      it('should add response_format with json_schema', () => {
        const { adapter } = provider._resolveProvider();
        const schema = {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'number' } },
          required: ['name'],
        };
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_schema', name: 'person', schema, strict: true },
        });

        expect(body.response_format.type).toBe('json_schema');
        expect(body.response_format.json_schema.name).toBe('person');
        expect(body.response_format.json_schema.schema).toEqual(schema);
        expect(body.response_format.json_schema.strict).toBe(true);
      });

      it('should default strict to true for json_schema', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_schema', schema: { type: 'object' } },
        });

        expect(body.response_format.json_schema.strict).toBe(true);
        expect(body.response_format.json_schema.name).toBe('response');
      });
    });

    describe('getHeaders', () => {
      it('should include Authorization bearer token', () => {
        const { adapter, config } = provider._resolveProvider();
        const headers = adapter.getHeaders(config);
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer sk-test');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Anthropic Adapter
  // ═══════════════════════════════════════════════════════════════

  describe('Anthropic Adapter', () => {
    const MESSAGES = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];

    const TOOLS = [{
      name: 'get_weather',
      description: 'Get current weather',
      parameters: { type: 'object', properties: { location: { type: 'string' } } },
    }];

    beforeEach(() => {
      provider.register('anthropic', {
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-ant-test',
        model: 'claude-sonnet-4-5-20250929',
      });
    });

    describe('formatRequest', () => {
      it('should extract system prompt and map tool_result messages to user role', () => {
        const { adapter } = provider._resolveProvider();
        const msgs = [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Use the tool.' },
          { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', name: 'get_weather', arguments: { location: 'Paris' } }] },
          { role: 'tool', content: '{"temp":22}', tool_call_id: 'tc_1' },
        ];

        const body = adapter.formatRequest(msgs, { tools: TOOLS });

        // System extracted to top-level
        expect(body.system).toBe('Be helpful.');

        // Messages should not contain system
        expect(body.messages.every(m => m.role !== 'system')).toBe(true);

        // Tool result mapped to user role with tool_result content block
        const toolResultMsg = body.messages[2];
        expect(toolResultMsg.role).toBe('user');
        expect(toolResultMsg.content[0].type).toBe('tool_result');
        expect(toolResultMsg.content[0].tool_use_id).toBe('tc_1');
        expect(toolResultMsg.content[0].content).toBe('{"temp":22}');

        // Assistant tool_calls mapped to tool_use blocks
        const assistantMsg = body.messages[1];
        expect(assistantMsg.role).toBe('assistant');
        expect(assistantMsg.content[0].type).toBe('tool_use');
        expect(assistantMsg.content[0].name).toBe('get_weather');
      });

      it('should set max_tokens with default of 4096', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES);
        expect(body.max_tokens).toBe(4096);
      });

      it('should use custom maxTokens', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { maxTokens: 2000 });
        expect(body.max_tokens).toBe(2000);
      });

      it('should map tools to input_schema format', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { tools: TOOLS });
        expect(body.tools[0].input_schema).toEqual(TOOLS[0].parameters);
        expect(body.tools[0].name).toBe('get_weather');
      });

      it('should join multiple system messages', () => {
        const { adapter } = provider._resolveProvider();
        const msgs = [
          { role: 'system', content: 'Rule one.' },
          { role: 'system', content: 'Rule two.' },
          { role: 'user', content: 'Go' },
        ];
        const body = adapter.formatRequest(msgs);
        expect(body.system).toBe('Rule one.\n\nRule two.');
      });
    });

    describe('parseResponse', () => {
      it('should parse text blocks and tool_use blocks', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(ANTHROPIC_RESPONSE);

        expect(result.content).toBe('Hello from Anthropic');
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls[0].id).toBe('toolu_01');
        expect(result.tool_calls[0].name).toBe('get_weather');
        expect(result.tool_calls[0].arguments).toEqual({ location: 'Paris' });
        expect(result.usage).toEqual({ prompt_tokens: 15, completion_tokens: 25 });
      });

      it('should return undefined tool_calls when none present', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(ANTHROPIC_RESPONSE_PLAIN);
        expect(result.content).toBe('Just text response');
        expect(result.tool_calls).toBeUndefined();
      });
    });

    describe('parseStreamChunk', () => {
      it('should parse content_block_delta with text_delta', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}';
        const chunk = adapter.parseStreamChunk(line);
        expect(chunk).toEqual({ type: 'text', content: 'Hi' });
      });

      it('should parse content_block_delta with input_json_delta', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}';
        const chunk = adapter.parseStreamChunk(line);
        expect(chunk.type).toBe('tool_call_delta');
        expect(chunk.argumentsDelta).toBe('{"loc');
      });

      it('should parse content_block_start for tool_use', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather"}}';
        const chunk = adapter.parseStreamChunk(line);
        expect(chunk).toEqual({ type: 'tool_call_start', id: 'toolu_01', name: 'get_weather' });
      });

      it('should parse message_stop as done', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"type":"message_stop"}';
        const chunk = adapter.parseStreamChunk(line);
        expect(chunk).toEqual({ type: 'done' });
      });

      it('should parse message_delta with usage', () => {
        const { adapter } = provider._resolveProvider();
        const line = 'data: {"type":"message_delta","usage":{"input_tokens":10,"output_tokens":20}}';
        const chunk = adapter.parseStreamChunk(line);
        expect(chunk.type).toBe('usage');
        expect(chunk.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
      });

      it('should return null for non-data lines', () => {
        const { adapter } = provider._resolveProvider();
        expect(adapter.parseStreamChunk('event: ping')).toBeNull();
      });
    });

    describe('responseFormat', () => {
      it('should append JSON instruction to system for "json"', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { responseFormat: 'json' });

        expect(body.system).toContain('You are helpful.');
        expect(body.system).toContain('You MUST respond with valid JSON only');
        // Prefill assistant message with '{'
        const lastMsg = body.messages[body.messages.length - 1];
        expect(lastMsg.role).toBe('assistant');
        expect(lastMsg.content).toBe('{');
      });

      it('should append schema to system prompt for json_schema', () => {
        const { adapter } = provider._resolveProvider();
        const schema = { type: 'object', properties: { name: { type: 'string' } } };
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_schema', schema },
        });

        expect(body.system).toContain('You MUST respond with valid JSON only');
        expect(body.system).toContain('"type": "object"');
        // Prefill
        const lastMsg = body.messages[body.messages.length - 1];
        expect(lastMsg.role).toBe('assistant');
        expect(lastMsg.content).toBe('{');
      });

      it('should create system from scratch when no system messages exist', () => {
        const { adapter } = provider._resolveProvider();
        const msgs = [{ role: 'user', content: 'Hello' }];
        const body = adapter.formatRequest(msgs, { responseFormat: 'json' });

        expect(body.system).toContain('You MUST respond with valid JSON only');
      });
    });

    describe('getHeaders', () => {
      it('should include x-api-key and anthropic-version', () => {
        const { adapter, config } = provider._resolveProvider();
        const headers = adapter.getHeaders(config);
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['x-api-key']).toBe('sk-ant-test');
        expect(headers['anthropic-version']).toBe('2023-06-01');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Ollama Adapter
  // ═══════════════════════════════════════════════════════════════

  describe('Ollama Adapter', () => {
    const MESSAGES = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];

    beforeEach(() => {
      provider.register('ollama', {
        endpoint: 'http://localhost:11434/api/chat',
        model: 'llama3',
      });
    });

    describe('formatRequest', () => {
      it('should produce correct structure with model and messages', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES);

        expect(body.model).toBe('llama3');
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
        expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
      });

      it('should map temperature to options.temperature', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { temperature: 0.5 });
        expect(body.options).toEqual({ temperature: 0.5 });
      });

      it('should set stream flag', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { stream: true });
        expect(body.stream).toBe(true);
      });

      it('should map tools to function format', () => {
        const { adapter } = provider._resolveProvider();
        const tools = [{ name: 'search', description: 'Search', parameters: { type: 'object' } }];
        const body = adapter.formatRequest(MESSAGES, { tools });
        expect(body.tools[0].type).toBe('function');
        expect(body.tools[0].function.name).toBe('search');
      });
    });

    describe('parseResponse', () => {
      it('should parse ollama response format', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(OLLAMA_RESPONSE);

        expect(result.content).toBe('Hello from Ollama');
        expect(result.tool_calls).toBeUndefined();
        expect(result.usage).toEqual({ prompt_tokens: 12, completion_tokens: 18 });
      });

      it('should parse tool calls with generated IDs', () => {
        const { adapter } = provider._resolveProvider();
        const result = adapter.parseResponse(OLLAMA_RESPONSE_WITH_TOOLS);

        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls[0].name).toBe('get_weather');
        expect(result.tool_calls[0].arguments).toEqual({ location: 'Paris' });
        expect(result.tool_calls[0].id).toMatch(/^ollama_0_/);
      });
    });

    describe('parseStreamChunk', () => {
      it('should parse text content from JSON line', () => {
        const { adapter } = provider._resolveProvider();
        const chunk = adapter.parseStreamChunk('{"message":{"content":"Hi"},"done":false}');
        expect(chunk).toEqual({ type: 'text', content: 'Hi' });
      });

      it('should parse done signal', () => {
        const { adapter } = provider._resolveProvider();
        const chunk = adapter.parseStreamChunk('{"done":true}');
        expect(chunk).toEqual({ type: 'done' });
      });

      it('should return null for malformed JSON', () => {
        const { adapter } = provider._resolveProvider();
        expect(adapter.parseStreamChunk('not-json')).toBeNull();
      });
    });

    describe('responseFormat', () => {
      it('should set format to "json" for json mode', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, { responseFormat: 'json' });
        expect(body.format).toBe('json');
      });

      it('should set format to json_object type', () => {
        const { adapter } = provider._resolveProvider();
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_object' },
        });
        expect(body.format).toBe('json');
      });

      it('should pass schema to format for json_schema', () => {
        const { adapter } = provider._resolveProvider();
        const schema = { type: 'object', properties: { x: { type: 'number' } } };
        const body = adapter.formatRequest(MESSAGES, {
          responseFormat: { type: 'json_schema', schema },
        });
        expect(body.format).toEqual(schema);
      });
    });

    describe('getHeaders', () => {
      it('should return only Content-Type (no auth needed for local Ollama)', () => {
        const { adapter } = provider._resolveProvider();
        const headers = adapter.getHeaders({});
        expect(headers).toEqual({ 'Content-Type': 'application/json' });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Per-message provider selection
  // ═══════════════════════════════════════════════════════════════

  describe('Per-message provider selection', () => {
    it('should use the named provider instead of active via options.provider', async () => {
      provider.register('openai', {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
      });
      provider.register('anthropic', {
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-ant-test',
      });

      // Active should be anthropic (last registered without active:false)
      expect(provider.getActiveProvider()).toBe('anthropic');

      // But we send with provider: 'openai'
      globalThis.fetch = mockFetchJson(OPENAI_RESPONSE_PLAIN);

      const result = await provider.send(
        [{ role: 'user', content: 'Hello' }],
        { provider: 'openai' },
      );

      expect(result.content).toBe('Just text, no tools');

      // Verify that the fetch was called with the OpenAI endpoint
      const calledUrl = globalThis.fetch.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('should throw when options.provider references unregistered name', async () => {
      provider.register('openai', { endpoint: 'https://api.openai.com/v1/chat/completions' });

      await expect(
        provider.send([{ role: 'user', content: 'Hello' }], { provider: 'ghost' }),
      ).rejects.toThrow(/Provider 'ghost' not registered/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Custom adapter
  // ═══════════════════════════════════════════════════════════════

  describe('Custom adapter', () => {
    it('should call user-provided send function', async () => {
      const customSend = vi.fn(async (messages) => ({
        content: `Echo: ${messages[0].content}`,
      }));

      provider.register('my-llm', {
        send: customSend,
      });

      const result = await provider.send([{ role: 'user', content: 'ping' }]);

      expect(customSend).toHaveBeenCalledOnce();
      expect(result.content).toBe('Echo: ping');
    });

    it('should call user-provided stream generator', async () => {
      async function* customStream(messages) {
        yield { type: 'text', content: 'chunk1' };
        yield { type: 'text', content: 'chunk2' };
        yield { type: 'done' };
      }

      provider.register('my-stream-llm', {
        stream: customStream,
      });

      const chunks = [];
      for await (const chunk of provider.stream([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'text', content: 'chunk1' });
      expect(chunks[1]).toEqual({ type: 'text', content: 'chunk2' });
      expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('should register custom adapter even with a name matching built-in', async () => {
      // If send/stream is provided, it takes precedence over built-in adapter lookup
      const customSend = vi.fn(async () => ({ content: 'custom openai' }));

      provider.register('openai', { send: customSend });
      const result = await provider.send([{ role: 'user', content: 'test' }]);

      expect(result.content).toBe('custom openai');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // JSON parsing (send with responseFormat)
  // ═══════════════════════════════════════════════════════════════

  describe('JSON parsing via send with responseFormat', () => {
    beforeEach(() => {
      provider.register('openai', {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
      });
      // Disable retry delays for test speed
      provider.configureRetry({ maxRetries: 0 });
    });

    it('should set result.parsed when response is valid JSON', async () => {
      globalThis.fetch = mockFetchJson({
        choices: [{
          message: { content: '{"name":"Wu","age":42}' },
        }],
      });

      const result = await provider.send(
        [{ role: 'user', content: 'Give me JSON' }],
        { responseFormat: 'json' },
      );

      expect(result.parsed).toEqual({ name: 'Wu', age: 42 });
      expect(result.parseError).toBeUndefined();
    });

    it('should set result.parseError when response is invalid JSON', async () => {
      globalThis.fetch = mockFetchJson({
        choices: [{
          message: { content: 'This is not JSON at all' },
        }],
      });

      const result = await provider.send(
        [{ role: 'user', content: 'Give me JSON' }],
        { responseFormat: 'json' },
      );

      expect(result.parsed).toBeUndefined();
      expect(result.parseError).toBe('Response is not valid JSON');
    });

    it('should not attempt JSON parsing when responseFormat is not set', async () => {
      globalThis.fetch = mockFetchJson(OPENAI_RESPONSE_PLAIN);

      const result = await provider.send(
        [{ role: 'user', content: 'Hello' }],
      );

      expect(result.parsed).toBeUndefined();
      expect(result.parseError).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Anthropic prefill compensation on send
  // ═══════════════════════════════════════════════════════════════

  describe('Anthropic prefill compensation', () => {
    it('should prepend "{" to content when responseFormat is used with Anthropic', async () => {
      provider.register('anthropic', {
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-ant-test',
      });
      provider.configureRetry({ maxRetries: 0 });

      // Anthropic will return the continuation after the prefilled '{'
      globalThis.fetch = mockFetchJson({
        content: [{ type: 'text', text: '"name":"Wu","age":42}' }],
        usage: { input_tokens: 5, output_tokens: 10 },
      });

      const result = await provider.send(
        [{ role: 'user', content: 'Give me JSON' }],
        { responseFormat: 'json' },
      );

      // The provider should have prepended '{' to complete the JSON
      expect(result.content).toBe('{"name":"Wu","age":42}');
      expect(result.parsed).toEqual({ name: 'Wu', age: 42 });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // send() integration with fetch
  // ═══════════════════════════════════════════════════════════════

  describe('send() integration', () => {
    it('should throw when no endpoint is configured', async () => {
      provider.register('openai', { apiKey: 'sk-test' });

      await expect(
        provider.send([{ role: 'user', content: 'hi' }]),
      ).rejects.toThrow(/No endpoint configured/);
    });

    it('should throw when no provider is active', async () => {
      // Fresh provider with nothing registered
      const empty = new WuAIProvider();
      await expect(
        empty.send([{ role: 'user', content: 'hi' }]),
      ).rejects.toThrow(/No provider configured/);
    });

    it('should resolve relative URLs against window.location.origin', async () => {
      // Simulate browser environment
      const origWindow = globalThis.window;
      globalThis.window = { location: { origin: 'https://myapp.com' } };

      provider.register('openai', {
        endpoint: '/api/ai/chat',
        apiKey: 'sk-test',
      });
      provider.configureRetry({ maxRetries: 0 });

      globalThis.fetch = mockFetchJson(OPENAI_RESPONSE_PLAIN);

      await provider.send([{ role: 'user', content: 'hi' }]);

      const calledUrl = globalThis.fetch.mock.calls[0][0];
      expect(calledUrl).toBe('https://myapp.com/api/ai/chat');

      globalThis.window = origWindow;
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Retry logic
  // ═══════════════════════════════════════════════════════════════

  describe('retry logic', () => {
    beforeEach(() => {
      provider.register('openai', {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
      });
      // Fast retries for testing
      provider.configureRetry({ maxRetries: 2, baseDelayMs: 1 });
    });

    it('should retry on 429 and succeed', async () => {
      let attempt = 0;
      globalThis.fetch = vi.fn(() => {
        attempt++;
        if (attempt < 2) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(OPENAI_RESPONSE_PLAIN),
        });
      });

      const result = await provider.send([{ role: 'user', content: 'hi' }]);
      expect(result.content).toBe('Just text, no tools');
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 and succeed', async () => {
      let attempt = 0;
      globalThis.fetch = vi.fn(() => {
        attempt++;
        if (attempt < 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(OPENAI_RESPONSE_PLAIN),
        });
      });

      const result = await provider.send([{ role: 'user', content: 'hi' }]);
      expect(result.content).toBe('Just text, no tools');
    });

    it('should NOT retry on 400 (client error)', async () => {
      globalThis.fetch = vi.fn(() => Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      }));

      await expect(
        provider.send([{ role: 'user', content: 'hi' }]),
      ).rejects.toThrow(/Request failed: 400/);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should propagate AbortError without retry', async () => {
      globalThis.fetch = vi.fn(() => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      await expect(
        provider.send([{ role: 'user', content: 'hi' }]),
      ).rejects.toThrow('Aborted');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // configureRetry & getStats
  // ═══════════════════════════════════════════════════════════════

  describe('utility methods', () => {
    it('should configure retry settings', () => {
      provider.configureRetry({ maxRetries: 5, baseDelayMs: 500 });
      expect(provider._retryConfig.maxRetries).toBe(5);
      expect(provider._retryConfig.baseDelayMs).toBe(500);
    });

    it('should return stats with all registered providers', () => {
      provider.register('openai', { endpoint: 'https://api.openai.com/v1/chat/completions' });
      provider.register('ollama', { endpoint: 'http://localhost:11434/api/chat' });

      const stats = provider.getStats();
      expect(stats.activeProvider).toBe('ollama');
      expect(stats.registeredProviders).toEqual(['openai', 'ollama']);
    });
  });
});
