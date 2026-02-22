/**
 * WU-FRAMEWORK VUE AI INTEGRATION
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;
  return window.wu || window.parent?.wu || window.top?.wu || null;
}

export function createUseWuAI(Vue) {
  const { ref } = Vue;
  return function useWuAI(options = {}) {
    const { namespace = 'default' } = options;
    const messages = ref([]);
    const isStreaming = ref(false);
    const error = ref(null);
    async function send(text) {
      if (!text?.trim()) return;
      const wu = getWuInstance();
      if (!wu?.ai) { error.value = 'Wu AI not available'; return; }
      messages.value = [...messages.value, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }];
      error.value = null; isStreaming.value = true;
      try {
        const res = await wu.ai.send(text, { namespace });
        messages.value = [...messages.value, { id: `assistant-${Date.now()}`, role: 'assistant', content: res.content, timestamp: Date.now() }];
      } catch (err) { error.value = err.message || 'AI request failed'; }
      isStreaming.value = false;
    }
    function clear() { messages.value = []; error.value = null; }
    return { messages, isStreaming, error, send, clear };
  };
}

export function useWuAI(options = {}) {
  const { namespace = 'default' } = options;
  const state = { messages: [], isStreaming: false, error: null };
  return {
    ...state,
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
  };
}
