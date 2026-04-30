(() => {
  const css = `
    :host {
      display: block;
      height: 100%;
      box-sizing: border-box;
      padding:
        var(--argent-a2ui-inset-top, 0px)
        var(--argent-a2ui-inset-right, 0px)
        var(--argent-a2ui-inset-bottom, 0px)
        var(--argent-a2ui-inset-left, 0px);
      color: rgba(255,255,255,.9);
      font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    }
    .empty {
      position: absolute;
      left: 50%;
      top: var(--argent-a2ui-empty-top, 18px);
      transform: translateX(-50%);
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(0,0,0,.42);
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 10px 24px rgba(0,0,0,.25);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      pointer-events: none;
    }
    .surface {
      margin: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.035));
      border: 1px solid rgba(255,255,255,.1);
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `;

  function normalizeMessages(messages) {
    if (Array.isArray(messages)) return messages;
    if (messages && Array.isArray(messages.messages)) return messages.messages;
    return [];
  }

  class ArgentA2UIFallbackHost extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.surfaces = [];
      globalThis.argentA2UI = {
        applyMessages: (messages) => this.applyMessages(messages),
        getSurfaces: () => this.surfaces.slice(),
        reset: () => {
          this.surfaces = [];
          this.render();
          return { ok: true, surfaces: [] };
        },
      };
    }

    connectedCallback() {
      this.render();
    }

    applyMessages(messages) {
      const normalized = normalizeMessages(messages);
      for (const message of normalized) {
        this.surfaces.push(message);
      }
      this.render();
      return { ok: true, surfaces: this.surfaces.map((_, index) => String(index)) };
    }

    render() {
      if (!this.shadowRoot) return;
      const content = this.surfaces.length
        ? this.surfaces
            .map(
              (surface) =>
                `<div class="surface">${escapeHtml(JSON.stringify(surface, null, 2))}</div>`,
            )
            .join("")
        : `<div class="empty">Waiting for A2UI messages...</div>`;
      this.shadowRoot.innerHTML = `<style>${css}</style>${content}`;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  if (!customElements.get("argent-a2ui-host")) {
    customElements.define("argent-a2ui-host", ArgentA2UIFallbackHost);
  }
})();
