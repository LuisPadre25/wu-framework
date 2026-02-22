/**
 * WU-FRAMEWORK PREACT AI INTEGRATION
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;
  return window.wu || window.parent?.wu || window.top?.wu || null;
}

export function createUseWuAI(hooks) {
  const { useState, useCallback } = hooks;
  return function useWuAI(options = {}) {
    const { namespace = 'default' } = options;
    const [messages, setMessages] = useState([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState(null);

    const send = useCallback(async (text) => {
      if (!text?.trim()) return;
      const wu = getWuInstance();
      if (!wu?.ai) { setError('Wu AI not available'); return; }
      setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }]);
      setIsStreaming(true); setError(null);
      try {
        const res = await wu.ai.send(text, { namespace });
        setMessages(prev => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', content: res.content, timestamp: Date.now() }]);
      } catch (err) { setError(err.message || 'AI request failed'); }
      setIsStreaming(false);
    }, [namespace]);

    const clear = useCallback(() => { setMessages([]); setError(null); }, []);
    return { messages, isStreaming, error, send, clear };
  };
}
