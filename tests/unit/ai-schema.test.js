import { describe, it, expect } from 'vitest';
import {
  sanitizeForPrompt,
  redactSensitive,
  interpolate,
  normalizeParameters,
  validateParams,
  buildToolSchemas,
  estimateTokens,
  truncateToTokenBudget,
} from '../../src/ai/wu-ai-schema.js';

describe('WuAISchema', () => {

  // ── sanitizeForPrompt ──

  describe('sanitizeForPrompt', () => {
    it('should return "null" for null/undefined', () => {
      expect(sanitizeForPrompt(null)).toBe('null');
      expect(sanitizeForPrompt(undefined)).toBe('null');
    });

    it('should wrap strings in <user_data> tags', () => {
      expect(sanitizeForPrompt('hello')).toBe('<user_data>hello</user_data>');
    });

    it('should truncate long strings', () => {
      const long = 'a'.repeat(3000);
      const result = sanitizeForPrompt(long, 100);
      expect(result).toContain('...[truncated]');
      expect(result.length).toBeLessThan(200);
    });

    it('should convert numbers and booleans to strings', () => {
      expect(sanitizeForPrompt(42)).toBe('42');
      expect(sanitizeForPrompt(true)).toBe('true');
    });

    it('should handle functions and symbols', () => {
      expect(sanitizeForPrompt(() => {})).toBe('[Function]');
      expect(sanitizeForPrompt(Symbol('x'))).toBe('[Symbol]');
    });

    it('should redact sensitive fields in objects', () => {
      const result = sanitizeForPrompt({ name: 'wu', password: 'secret' });
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('secret');
    });
  });

  // ── redactSensitive ──

  describe('redactSensitive', () => {
    it('should redact sensitive keys', () => {
      const obj = { username: 'joe', password: '123', apiKey: 'sk-xxx' };
      const result = redactSensitive(obj);
      expect(result.username).toBe('joe');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const obj = { user: { name: 'joe', token: 'abc' } };
      const result = redactSensitive(obj);
      expect(result.user.name).toBe('joe');
      expect(result.user.token).toBe('[REDACTED]');
    });

    it('should handle arrays', () => {
      const arr = [{ name: 'a' }, { secret: 'x' }];
      const result = redactSensitive(arr);
      expect(result[0].name).toBe('a');
      expect(result[1].secret).toBe('[REDACTED]');
    });

    it('should not modify primitives', () => {
      expect(redactSensitive(42)).toBe(42);
      expect(redactSensitive('hello')).toBe('hello');
      expect(redactSensitive(null)).toBe(null);
    });

    it('should handle max depth', () => {
      let obj = { a: 'b' };
      for (let i = 0; i < 15; i++) obj = { nested: obj };
      const result = redactSensitive(obj);
      expect(JSON.stringify(result)).toContain('[MAX_DEPTH]');
    });
  });

  // ── interpolate ──

  describe('interpolate', () => {
    it('should replace simple variables', () => {
      expect(interpolate('Hello {{name}}', { name: 'Wu' })).toBe('Hello Wu');
    });

    it('should replace dot-notation variables', () => {
      expect(interpolate('{{user.name}}', { user: { name: 'Joe' } })).toBe('Joe');
    });

    it('should replace missing vars with empty string', () => {
      expect(interpolate('Hello {{missing}}', {})).toBe('Hello ');
    });

    it('should handle object values', () => {
      const result = interpolate('Data: {{data}}', { data: { x: 1 } });
      expect(result).toContain('user_data');
    });
  });

  // ── normalizeParameters ──

  describe('normalizeParameters', () => {
    it('should return empty schema for null/undefined', () => {
      const result = normalizeParameters(null);
      expect(result.type).toBe('object');
      expect(result.properties).toEqual({});
    });

    it('should pass through full JSON Schema', () => {
      const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
      expect(normalizeParameters(schema)).toBe(schema);
    });

    it('should convert shorthand string format', () => {
      const result = normalizeParameters({ name: 'string', age: 'number' });
      expect(result.properties.name.type).toBe('string');
      expect(result.properties.age.type).toBe('number');
    });

    it('should convert shorthand object format with required', () => {
      const result = normalizeParameters({
        message: { type: 'string', required: true },
        count: { type: 'number' },
      });
      expect(result.required).toContain('message');
      expect(result.properties.message.type).toBe('string');
      expect(result.properties.count.type).toBe('number');
    });
  });

  // ── validateParams ──

  describe('validateParams', () => {
    const schema = normalizeParameters({
      name: { type: 'string', required: true },
      age: { type: 'number' },
      role: { type: 'string', enum: ['admin', 'user'] },
    });

    it('should pass valid params', () => {
      const result = validateParams({ name: 'Wu', age: 5, role: 'admin' }, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail on missing required', () => {
      const result = validateParams({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("'name' is required");
    });

    it('should fail on wrong type', () => {
      const result = validateParams({ name: 'Wu', age: 'five' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("'age' must be number");
    });

    it('should fail on invalid enum value', () => {
      const result = validateParams({ name: 'Wu', role: 'superadmin' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be one of");
    });

    it('should pass with no schema', () => {
      expect(validateParams({ any: 'thing' }, null).valid).toBe(true);
    });

    it('should validate integer type', () => {
      const intSchema = normalizeParameters({ count: { type: 'integer' } });
      expect(validateParams({ count: 5 }, intSchema).valid).toBe(true);
      expect(validateParams({ count: 5.5 }, intSchema).valid).toBe(false);
    });
  });

  // ── buildToolSchemas ──

  describe('buildToolSchemas', () => {
    it('should build tool schemas from actions map', () => {
      const actions = new Map([
        ['search', { description: 'Search items', parameters: { query: 'string' } }],
        ['delete', { description: 'Delete item', parameters: { id: { type: 'string', required: true } } }],
      ]);
      const tools = buildToolSchemas(actions);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('search');
      expect(tools[0].description).toBe('Search items');
      expect(tools[0].parameters.type).toBe('object');
      expect(tools[1].parameters.required).toContain('id');
    });
  });

  // ── Token utilities ──

  describe('estimateTokens', () => {
    it('should estimate tokens from text length', () => {
      expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4
    });
  });

  describe('truncateToTokenBudget', () => {
    it('should not truncate short text', () => {
      expect(truncateToTokenBudget('hello', 100)).toBe('hello');
    });

    it('should truncate long text', () => {
      const long = 'a'.repeat(500);
      const result = truncateToTokenBudget(long, 10, 4);
      expect(result.length).toBeLessThan(500);
      expect(result).toContain('truncated');
    });
  });
});
