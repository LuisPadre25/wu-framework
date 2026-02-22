/**
 * WU-AI-SCHEMA: Tool schema generation for function calling
 *
 * Converts wu.ai.action() definitions into the canonical tool format
 * that providers consume. Also handles input sanitization for prompts.
 *
 * Canonical tool format:
 * { name: string, description: string, parameters: JSONSchema }
 */

// ─── Sanitization ────────────────────────────────────────────────

const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'secret', 'credential', 'authorization', 'cookie', 'session'];

/**
 * Sanitize data before injecting into prompts.
 * Prevents prompt injection and redacts sensitive fields.
 *
 * @param {*} data - Any value to sanitize
 * @param {number} [maxChars=2000] - Max chars per value
 * @returns {string} Safe string representation
 */
export function sanitizeForPrompt(data, maxChars = 2000) {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'function') return '[Function]';
  if (typeof data === 'symbol') return '[Symbol]';

  if (typeof data === 'string') {
    const truncated = data.length > maxChars ? data.slice(0, maxChars) + '...[truncated]' : data;
    return `<user_data>${truncated}</user_data>`;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (typeof data === 'object') {
    const redacted = redactSensitive(data);
    const json = JSON.stringify(redacted);
    if (json.length > maxChars) {
      return `<user_data>${json.slice(0, maxChars)}...[truncated]</user_data>`;
    }
    return `<user_data>${json}</user_data>`;
  }

  return String(data).slice(0, maxChars);
}

/**
 * Deep-clone an object, replacing sensitive keys with [REDACTED].
 *
 * @param {*} obj
 * @param {number} [depth=0]
 * @returns {*}
 */
export function redactSensitive(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitive(value, depth + 1);
    }
  }
  return result;
}

// ─── Template Interpolation ──────────────────────────────────────

/**
 * Interpolate {{var}} placeholders in a template string.
 * Supports dot-notation: {{data.user.name}}
 *
 * @param {string} template
 * @param {object} vars - Variable map { data: ..., context: ... }
 * @returns {string}
 */
export function interpolate(template, vars) {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path) => {
    const value = path.split('.').reduce((obj, key) => obj?.[key], vars);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return sanitizeForPrompt(value);
    return String(value);
  });
}

// ─── Tool Schema Builder ─────────────────────────────────────────

/**
 * Build canonical tool definitions from registered actions.
 *
 * @param {Map<string, object>} actions - Map of action name → config
 * @returns {Array<{ name: string, description: string, parameters: object }>}
 */
export function buildToolSchemas(actions) {
  const tools = [];

  for (const [name, config] of actions) {
    tools.push({
      name,
      description: config.description || `Execute action: ${name}`,
      parameters: normalizeParameters(config.parameters),
    });
  }

  return tools;
}

/**
 * Normalize user-provided parameter definitions into JSON Schema.
 *
 * Accepts two formats:
 * 1. Full JSON Schema: { type: 'object', properties: {...}, required: [...] }
 * 2. Shorthand: { message: { type: 'string', required: true }, count: { type: 'number' } }
 *
 * @param {object} params
 * @returns {object} Valid JSON Schema
 */
export function normalizeParameters(params) {
  if (!params || typeof params !== 'object') {
    return { type: 'object', properties: {}, required: [] };
  }

  // Already a JSON Schema
  if (params.type === 'object' && params.properties) {
    return params;
  }

  // Shorthand format — convert
  const properties = {};
  const required = [];

  for (const [key, def] of Object.entries(params)) {
    if (typeof def === 'string') {
      // Simplest: { message: 'string' }
      properties[key] = { type: def };
    } else if (typeof def === 'object') {
      const { required: isRequired, ...rest } = def;
      properties[key] = rest.type ? rest : { type: 'string', ...rest };
      if (isRequired) required.push(key);
    }
  }

  return { type: 'object', properties, required };
}

/**
 * Validate params against a JSON Schema (lightweight, no external deps).
 * Only checks type, required, and enum — not full JSON Schema validation.
 *
 * @param {object} params - Actual params from LLM
 * @param {object} schema - JSON Schema from normalizeParameters()
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateParams(params, schema) {
  const errors = [];
  if (!schema || !schema.properties) return { valid: true, errors };

  // Check required
  for (const key of (schema.required || [])) {
    if (params[key] === undefined || params[key] === null) {
      errors.push(`'${key}' is required`);
    }
  }

  // Check types and enums
  for (const [key, def] of Object.entries(schema.properties)) {
    const value = params[key];
    if (value === undefined || value === null) continue;

    if (def.type && def.type !== 'any') {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (def.type === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`'${key}' must be integer, got ${actualType}`);
        }
      } else if (def.type !== actualType) {
        errors.push(`'${key}' must be ${def.type}, got ${actualType}`);
      }
    }

    if (def.enum && !def.enum.includes(value)) {
      errors.push(`'${key}' must be one of [${def.enum.join(', ')}], got '${value}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Context Budget ──────────────────────────────────────────────

/**
 * Estimate token count from character count.
 * Rough heuristic: 1 token ≈ 4 chars for English, ≈ 2 chars for CJK.
 *
 * @param {string} text
 * @param {number} [charRatio=4]
 * @returns {number}
 */
export function estimateTokens(text, charRatio = 4) {
  return Math.ceil(text.length / charRatio);
}

/**
 * Truncate text to fit within a token budget.
 *
 * @param {string} text
 * @param {number} maxTokens
 * @param {number} [charRatio=4]
 * @returns {string}
 */
export function truncateToTokenBudget(text, maxTokens, charRatio = 4) {
  const maxChars = maxTokens * charRatio;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[truncated to fit token budget]';
}
