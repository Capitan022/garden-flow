const GARDEN_FLOW_CARD_TYPE = "garden-flow-program-card";
const GARDEN_FLOW_DOCS_URL = "https://github.com/Capitan022/garden-flow";

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === GARDEN_FLOW_CARD_TYPE)) {
  window.customCards.push({
    type: GARDEN_FLOW_CARD_TYPE,
    name: "Garden Flow Program",
    description: "Run and monitor a Garden Flow irrigation or outdoor automation program.",
    preview: true,
    documentationURL: GARDEN_FLOW_DOCS_URL,
  });
}

class GardenFlowProgramCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { type: `custom:${GARDEN_FLOW_CARD_TYPE}` };
    this._hass = undefined;
    this._state = {
      loading: true,
      error: "",
      programs: [],
      runningProgramIds: [],
      nextRuns: {},
    };
    this._lastRefreshTs = 0;
    this._refreshPromise = null;
    this._actionPromise = null;

    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
  }

  static getStubConfig() {
    return {
      title: "Garden Flow",
      show_blocks: true,
      compact: false,
    };
  }

  setConfig(config) {
    this._config = {
      title: "Garden Flow",
      show_blocks: true,
      compact: false,
      ...config,
    };
    this._render();
  }

  getCardSize() {
    return this._config.compact ? 3 : 5;
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeRefresh();
    this._render();
  }

  connectedCallback() {
    this._maybeRefresh(true);
    this._render();
  }

  _maybeRefresh(force = false) {
    if (!this._hass?.connection) {
      return;
    }
    const now = Date.now();
    if (!force && this._refreshPromise) {
      return;
    }
    if (!force && this._lastRefreshTs && now - this._lastRefreshTs < 10000) {
      return;
    }
    this._loadState();
  }

  async _loadState() {
    if (!this._hass?.connection) {
      return;
    }
    if (!this._refreshPromise) {
      this._setState({ loading: true, error: "" });
    }

    this._refreshPromise = this._hass.connection
      .sendMessagePromise({ type: "garden_flow/list_state" })
      .then((response) => {
        this._lastRefreshTs = Date.now();
        this._state = {
          loading: false,
          error: "",
          programs: response.result.programs || [],
          runningProgramIds: response.result.running_program_ids || [],
          nextRuns: response.result.next_runs || {},
        };
        this._render();
      })
      .catch((error) => {
        this._state = {
          ...this._state,
          loading: false,
          error: error?.message || "Failed to load Garden Flow state.",
        };
        this._render();
      })
      .finally(() => {
        this._refreshPromise = null;
      });
  }

  _setState(partialState) {
    this._state = { ...this._state, ...partialState };
    this._render();
  }

  _selectedProgram() {
    if (!this._state.programs.length) {
      return null;
    }
    if (this._config.program_id) {
      return (
        this._state.programs.find((program) => program.id === this._config.program_id) || null
      );
    }
    return this._state.programs[0];
  }

  _isRunning(programId) {
    return this._state.runningProgramIds.includes(programId);
  }

  _formatWeekdays(weekdays) {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return (weekdays || []).map((day) => labels[day] || "?").join(" · ");
  }

  _formatTime(minutesFromStart) {
    const normalized = ((minutesFromStart % 1440) + 1440) % 1440;
    const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mins = String(normalized % 60).padStart(2, "0");
    return `${hours}:${mins}`;
  }

  _programBaseMinutes(program) {
    const [hours, minutes] = (program.start_time || "00:00")
      .split(":")
      .map((value) => Number(value));
    return hours * 60 + minutes;
  }

  _timelineSegments(program, block) {
    const startMinutes = (this._programBaseMinutes(program) + Number(block.offset_minutes)) % 1440;
    const endMinutes = startMinutes + Number(block.duration_minutes);

    if (endMinutes <= 1440) {
      return [
        {
          left: (startMinutes / 1440) * 100,
          width: (Number(block.duration_minutes) / 1440) * 100,
        },
      ];
    }

    return [
      {
        left: (startMinutes / 1440) * 100,
        width: ((1440 - startMinutes) / 1440) * 100,
      },
      {
        left: 0,
        width: ((endMinutes - 1440) / 1440) * 100,
      },
    ];
  }

  async _runAction(actionType, programId) {
    if (!this._hass?.connection || !programId || this._actionPromise) {
      return;
    }

    this._setState({ error: "" });
    this._actionPromise = this._hass.connection
      .sendMessagePromise({ type: actionType, program_id: programId })
      .then((response) => {
        this._lastRefreshTs = Date.now();
        this._state = {
          ...this._state,
          loading: false,
          error: "",
          programs: response.result.programs || [],
          runningProgramIds: response.result.running_program_ids || [],
          nextRuns: response.result.next_runs || {},
        };
      })
      .catch((error) => {
        this._setState({
          error: error?.message || "Failed to execute Garden Flow action.",
        });
      })
      .finally(() => {
        this._actionPromise = null;
        this._render();
      });
  }

  _handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const program = this._selectedProgram();
    if (!program) {
      return;
    }

    const action = target.dataset.action;
    if (action === "run") {
      this._runAction("garden_flow/run_program", program.id);
      return;
    }
    if (action === "stop") {
      this._runAction("garden_flow/stop_program", program.id);
      return;
    }
    if (action === "refresh") {
      this._maybeRefresh(true);
    }
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _renderProgram(program) {
    const isRunning = this._isRunning(program.id);
    const nextRun = this._state.nextRuns[program.id];
    const compact = Boolean(this._config.compact);
    const showBlocks = this._config.show_blocks !== false;
    const baseMinutes = this._programBaseMinutes(program);

    const blockMarkup = showBlocks
      ? `
        <div class="blocks">
          ${program.blocks
            .map((block) => {
              const absoluteStart = baseMinutes + Number(block.offset_minutes);
              const absoluteEnd = absoluteStart + Number(block.duration_minutes);
              const segments = this._timelineSegments(program, block)
                .map(
                  (segment) => `
                    <div
                      class="segment"
                      style="left:${segment.left}%;width:${segment.width}%;background:${this._escape(block.color || "#4f7f52")};"
                    ></div>
                  `
                )
                .join("");

              return `
                <div class="block">
                  <div class="block-top">
                    <div>
                      <strong>${this._escape(block.label)}</strong>
                      <div class="muted">${this._escape(block.entity_id)}</div>
                    </div>
                    <div class="block-time">
                      ${this._escape(this._formatTime(absoluteStart))} →
                      ${this._escape(this._formatTime(absoluteEnd))}
                    </div>
                  </div>
                  <div class="track">${segments}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      : "";

    return `
      <ha-card header="${this._escape(this._config.title || program.name)}">
        <div class="card-shell ${compact ? "compact" : ""}">
          <div class="hero">
            <div>
              <div class="program-name">${this._escape(program.name)}</div>
              <div class="muted">
                Start ${this._escape(program.start_time)} · ${this._escape(this._formatWeekdays(program.weekdays))}
              </div>
            </div>
            <div class="chips">
              <span class="chip ${program.enabled ? "enabled" : "disabled"}">
                ${program.enabled ? "Enabled" : "Disabled"}
              </span>
              <span class="chip ${isRunning ? "running" : "idle"}">
                ${isRunning ? "Running" : "Idle"}
              </span>
            </div>
          </div>

          <div class="summary">
            <div class="metric">
              <span class="label">Blocks</span>
              <span class="value">${program.blocks.length}</span>
            </div>
            <div class="metric">
              <span class="label">Next run</span>
              <span class="value small">${this._escape(nextRun || "Not scheduled")}</span>
            </div>
          </div>

          <div class="actions">
            <button class="primary" data-action="run">Run now</button>
            <button class="secondary" data-action="stop">Stop</button>
            <button class="ghost" data-action="refresh">Refresh</button>
          </div>

          ${compact ? "" : blockMarkup}
        </div>
      </ha-card>
    `;
  }

  _renderEmpty(message) {
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card header="${this._escape(this._config.title || "Garden Flow")}">
        <div class="card-shell empty">
          <div class="muted">${this._escape(message)}</div>
        </div>
      </ha-card>
    `;
  }

  _styles() {
    return `
      :host {
        display: block;
      }

      * {
        box-sizing: border-box;
      }

      ha-card {
        overflow: hidden;
      }

      .card-shell {
        padding: 16px;
        display: grid;
        gap: 14px;
        background:
          radial-gradient(circle at top right, rgba(214, 170, 116, 0.16), transparent 28%),
          linear-gradient(180deg, rgba(245, 248, 241, 0.9), rgba(250, 247, 242, 0.98));
      }

      .card-shell.compact {
        gap: 12px;
      }

      .card-shell.empty {
        padding: 20px 16px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .program-name {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--primary-text-color);
        margin-bottom: 4px;
      }

      .muted {
        color: var(--secondary-text-color);
        line-height: 1.4;
        font-size: 0.9rem;
      }

      .chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .chip {
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 0.78rem;
        font-weight: 700;
        border: 1px solid transparent;
      }

      .chip.enabled,
      .chip.idle {
        color: #24572f;
        background: rgba(89, 145, 94, 0.12);
        border-color: rgba(89, 145, 94, 0.24);
      }

      .chip.disabled {
        color: #6a5c45;
        background: rgba(120, 103, 76, 0.1);
        border-color: rgba(120, 103, 76, 0.2);
      }

      .chip.running {
        color: #8f4f2b;
        background: rgba(200, 108, 61, 0.14);
        border-color: rgba(200, 108, 61, 0.24);
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .metric {
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(103, 95, 80, 0.1);
        border-radius: 14px;
        padding: 10px 12px;
        display: grid;
        gap: 3px;
      }

      .metric .label {
        color: var(--secondary-text-color);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .metric .value {
        color: var(--primary-text-color);
        font-weight: 700;
        font-size: 1rem;
      }

      .metric .value.small {
        font-size: 0.88rem;
        line-height: 1.35;
      }

      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      button {
        border: none;
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
        cursor: pointer;
      }

      .primary {
        color: white;
        background: linear-gradient(135deg, #446f48 0%, #5b915e 100%);
      }

      .secondary {
        color: #5e402c;
        background: rgba(230, 205, 173, 0.72);
      }

      .ghost {
        color: var(--primary-text-color);
        background: transparent;
        border: 1px solid rgba(103, 95, 80, 0.18);
      }

      .blocks {
        display: grid;
        gap: 12px;
      }

      .block {
        background: rgba(255, 255, 255, 0.78);
        border: 1px solid rgba(103, 95, 80, 0.1);
        border-radius: 14px;
        padding: 12px;
        display: grid;
        gap: 10px;
      }

      .block-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .block-time {
        color: var(--secondary-text-color);
        font-size: 0.85rem;
        white-space: nowrap;
      }

      .track {
        position: relative;
        min-height: 16px;
        border-radius: 999px;
        overflow: hidden;
        border: 1px solid rgba(103, 95, 80, 0.1);
        background:
          repeating-linear-gradient(
            90deg,
            rgba(103, 95, 80, 0.08) 0,
            rgba(103, 95, 80, 0.08) calc(100% / 24),
            rgba(255, 255, 255, 0.6) calc(100% / 24),
            rgba(255, 255, 255, 0.6) calc(100% / 12)
          );
      }

      .segment {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 999px;
      }

      .error {
        color: var(--error-color);
        font-size: 0.88rem;
      }
    `;
  }

  _render() {
    const program = this._selectedProgram();
    if (!this._hass) {
      this._renderEmpty("Waiting for Home Assistant connection.");
      return;
    }

    if (this._state.loading && !program) {
      this._renderEmpty("Loading Garden Flow programs...");
      return;
    }

    if (this._config.program_id && !program) {
      this._renderEmpty(`Program "${this._config.program_id}" was not found.`);
      return;
    }

    if (!program) {
      this._renderEmpty("No Garden Flow programs exist yet. Create one from the Garden Flow panel.");
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      ${this._renderProgram(program)}
      ${this._state.error ? `<div class="error">${this._escape(this._state.error)}</div>` : ""}
    `;
  }
}

if (!customElements.get(GARDEN_FLOW_CARD_TYPE)) {
  customElements.define(GARDEN_FLOW_CARD_TYPE, GardenFlowProgramCard);
}
