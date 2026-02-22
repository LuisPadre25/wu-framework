/**
 * WU-AI React Hook
 *
 * Provides AI integration using React hooks.
 * Factory pattern: createUseWuAI(React) returns useWuAI().
 *
 * @example
 * import { createUseWuAI } from 'wu-framework/adapters/react';
 * import React from 'react';
 *
 * const useWuAI = createUseWuAI(React);
 * const { messages, send, isStreaming } = useWuAI();
 */

import { getWuInstance } from '../shared.js';

/**
 * Factory that creates the useWuAI hook for React.
 *
 * @param {object} React - React object with hooks (useState, useCallback, useRef, useEffect)
 * @returns {Function} useWuAI(options)
 */
export function createUseWuAI(React) {
  const { useState, useCallback, useRef, useEffect } = React;

  return function useWuAI(options = {}) {
    const { namespace = 'default', onActionExecuted = null } = options;

    const [messages, setMessages] = useState([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState(null);
    const actionListenerRef = useRef(null);

    // Listen for action execution events to provide visual feedback
    useEffect(() => {
      const wu = getWuInstance();
      if (!wu?.eventBus) return;

      const unsub = wu.eventBus.on('ai:action:executed', (event) => {
        const actionMsg = {
          id: `action-${Date.now()}`,
          role: 'action',
          content: event.data?.action || 'action',
          result: event.data?.result,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, actionMsg]);
        if (onActionExecuted) onActionExecuted(event.data);
      });

      actionListenerRef.current = unsub;
      return () => { if (unsub) unsub(); };
    }, [onActionExecuted]);

    const send = useCallback(async (text) => {
      if (!text?.trim()) return;
      const wu = getWuInstance();
      if (!wu?.ai) { setError('Wu AI not available'); return; }

      setMessages((prev) => [...prev, {
        id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now(),
      }]);
      setError(null);
      setIsStreaming(true);

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [...prev, {
        id: assistantId, role: 'assistant', content: '', timestamp: Date.now(),
      }]);

      try {
        let fullContent = '';
        for await (const chunk of wu.ai.stream(text, { namespace })) {
          if (chunk.type === 'text') {
            fullContent += chunk.content;
            const captured = fullContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: captured } : m,
              ),
            );
          }
          if (chunk.type === 'error') {
            setError(chunk.error?.message || 'AI request failed');
          }
        }
      } catch (err) {
        setError(err.message || 'AI request failed');
        setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
      } finally {
        setIsStreaming(false);
      }
    }, [namespace]);

    const sendSync = useCallback(async (text) => {
      if (!text?.trim()) return null;
      const wu = getWuInstance();
      if (!wu?.ai) { setError('Wu AI not available'); return null; }

      setMessages((prev) => [...prev, {
        id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now(),
      }]);
      setError(null);
      setIsStreaming(true);

      try {
        const response = await wu.ai.send(text, { namespace });
        setMessages((prev) => [...prev, {
          id: `assistant-${Date.now()}`, role: 'assistant', content: response.content, timestamp: Date.now(),
        }]);
        return response;
      } catch (err) {
        setError(err.message || 'AI request failed');
        return null;
      } finally {
        setIsStreaming(false);
      }
    }, [namespace]);

    const abort = useCallback(() => {
      const wu = getWuInstance();
      if (wu?.ai) wu.ai.abort(namespace);
      setIsStreaming(false);
    }, [namespace]);

    const clear = useCallback(() => {
      setMessages([]);
      setError(null);
      const wu = getWuInstance();
      if (wu?.ai) wu.ai.conversation.clear(namespace);
    }, [namespace]);

    return { messages, isStreaming, error, send, sendSync, abort, clear };
  };
}
