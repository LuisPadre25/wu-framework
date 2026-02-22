/**
 * WU-FRAMEWORK SVELTE AI INTEGRATION
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;
  return window.wu || window.parent?.wu || window.top?.wu || null;
}

export function createWuAIStore(options = {}) {
  const { namespace = 'default' } = options;
  const subscribers = new Set();
  let state = { messages: [], isStreaming: false, error: null };
  function notify() { subscribers.forEach(fn => fn(state)); }

  return {
    subscribe(fn) { subscribers.add(fn); fn(state); return () => subscribers.delete(fn); },
    async send(text) {
      if (!text?.trim()) return;
      const wu = getWuInstance();
      if (!wu?.ai) { state = { ...state, error: 'Wu AI not available' }; notify(); return; }
      state = { ...state, messages: [...state.messages, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }], isStreaming: true, error: null };
      notify();
      try {
        const res = await wu.ai.send(text, { namespace });
        state = { ...state, messages: [...state.messages, { id: `assistant-${Date.now()}`, role: 'assistant', content: res.content, timestamp: Date.now() }], isStreaming: false };
      } catch (err) { state = { ...state, isStreaming: false, error: err.message }; }
      notify();
    },
    clear() { state = { messages: [], isStreaming: false, error: null }; notify(); },
  };
}
