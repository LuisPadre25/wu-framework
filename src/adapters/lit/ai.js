/**
 * WU-FRAMEWORK LIT AI INTEGRATION
 */
function getWuInstance() {
  if (typeof window === 'undefined') return null;
  return window.wu || window.parent?.wu || window.top?.wu || null;
}

export function WuAIMixin(Base) {
  return class extends Base {
    constructor() { super(); this._wuAINamespace = 'default'; }
    get wuAI() { return getWuInstance()?.ai || null; }
    async wuAISend(text, options = {}) {
      const ai = this.wuAI;
      if (!ai) { console.warn('[WuAIMixin] wu.ai not available'); return null; }
      return ai.send(text, { namespace: this._wuAINamespace, ...options });
    }
    wuAISetNamespace(ns) { this._wuAINamespace = ns; }
  };
}
