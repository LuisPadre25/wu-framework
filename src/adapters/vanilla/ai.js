/**
 * WU-FRAMEWORK VANILLA JS AI INTEGRATION
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;
  return window.wu || window.parent?.wu || window.top?.wu || null;
}

export function useWuAI(options = {}) {
  const { namespace = 'default' } = options;
  const state = { messages: [], isStreaming: false, error: null };
  return {
    async send(text) {
      if (!text?.trim()) return null;
      const wu = getWuInstance();
      if (!wu?.ai) { state.error = 'Wu AI not available'; return null; }
      state.messages.push({ id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() });
      state.isStreaming = true; state.error = null;
      try {
        const res = await wu.ai.send(text, { namespace });
        state.messages.push({ id: `assistant-${Date.now()}`, role: 'assistant', content: res.content, timestamp: Date.now() });
        state.isStreaming = false; return res;
      } catch (err) { state.error = err.message; state.isStreaming = false; return null; }
    },
    clear() { state.messages.length = 0; state.error = null; },
    getMessages() { return [...state.messages]; },
    getError() { return state.error; },
    isStreaming() { return state.isStreaming; },
  };
}
