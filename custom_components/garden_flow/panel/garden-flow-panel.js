class GardenFlowPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = undefined;
    this._panel = undefined;
    this._bootstrapped = false;
    this._state = {
      loading: true,
      saving: false,
      error: "",
      programs: [],
      entities: [],
      runningProgramIds: [],
      nextRuns: {},
      selectedProgramId: null,
      draft: null,
    };

    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._handleInput(event));
    this.shadowRoot.addEventListener("change", (event) => this._handleInput(event));
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._bootstrapped) {
      this._bootstrapped = true;
      this._loadState();
    }
    this._render();
  }

  set panel(panel) {
    this._panel = panel;
    this._render();
  }

  connectedCallback() {
    this._render();
  }

  async _loadState() {
    this._setState({ loading: true, error: "" });
    try {
      const result = await this._callWS({ type: "garden_flow/list_state" });
      this._applyBackendState(result);
    } catch (error) {
      this._setState({
        loading: false,
        error: error?.message || "Failed to load Garden Flow state.",
      });
    }
  }

  async _saveDraft() {
    if (!this._state.draft) {
      return;
    }

    const validationError = this._validateDraft(this._state.draft);
    if (validationError) {
      this._setState({ error: validationError });
      return;
    }

    this._setState({ saving: true, error: "" });
    try {
      const result = await this._callWS({
        type: "garden_flow/save_program",
        program: this._state.draft,
      });
      this._applyBackendState(result, this._state.draft.id);
    } catch (error) {
      this._setState({
        saving: false,
        error: error?.message || "Failed to save program.",
      });
    }
  }

  async _deleteDraft() {
    if (!this._state.draft) {
      return;
    }
    if (!window.confirm(`Delete "${this._state.draft.name}"?`)) {
      return;
    }

    try {
      const result = await this._callWS({
        type: "garden_flow/delete_program",
        program_id: this._state.draft.id,
      });
      this._applyBackendState(result);
    } catch (error) {
      this._setState({ error: error?.message || "Failed to delete program." });
    }
  }

  async _runDraft() {
    if (!this._state.draft) {
      return;
    }
    try {
      const result = await this._callWS({
        type: "garden_flow/run_program",
        program_id: this._state.draft.id,
      });
      this._applyBackendState(result, this._state.draft.id);
    } catch (error) {
      this._setState({ error: error?.message || "Failed to start program." });
    }
  }

  async _stopDraft() {
    if (!this._state.draft) {
      return;
    }
    try {
      const result = await this._callWS({
        type: "garden_flow/stop_program",
        program_id: this._state.draft.id,
      });
      this._applyBackendState(result, this._state.draft.id);
    } catch (error) {
      this._setState({ error: error?.message || "Failed to stop program." });
    }
  }

  _callWS(message) {
    if (!this._hass?.connection) {
      throw new Error("Home Assistant connection is not ready.");
    }
    return this._hass.connection.sendMessagePromise(message).then((response) => response.result);
  }

  _applyBackendState(result, preferredProgramId = null) {
    const selectedId =
      preferredProgramId ||
      this._state.selectedProgramId ||
      (result.programs[0] && result.programs[0].id) ||
      null;
    const selectedProgram = result.programs.find((program) => program.id === selectedId) || null;

    this._state = {
      ...this._state,
      loading: false,
      saving: false,
      error: "",
      programs: result.programs || [],
      entities: result.entities || [],
      runningProgramIds: result.running_program_ids || [],
      nextRuns: result.next_runs || {},
      selectedProgramId: selectedProgram ? selectedProgram.id : null,
      draft: selectedProgram ? this._clone(selectedProgram) : null,
    };

    this._render();
  }

  _setState(partialState) {
    this._state = { ...this._state, ...partialState };
    this._render();
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _createProgram() {
    const firstEntity = this._state.entities[0] || null;
    const defaults = firstEntity
      ? {
          entity_id: firstEntity.entity_id,
          label: firstEntity.name,
          start_service: firstEntity.default_start_service,
          stop_service: firstEntity.default_stop_service,
        }
      : {
          entity_id: "",
          label: "New block",
          start_service: "switch.turn_on",
          stop_service: "switch.turn_off",
        };

    const program = {
      id: this._newId(),
      name: "New Program",
      enabled: true,
      start_time: "06:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      blocks: [
        {
          id: this._newId(),
          label: defaults.label,
          entity_id: defaults.entity_id,
          offset_minutes: 0,
          duration_minutes: 15,
          start_service: defaults.start_service,
          stop_service: defaults.stop_service,
          color: "#4f7f52",
          service_data: {},
          stop_service_data: {},
        },
      ],
    };

    this._setState({
      selectedProgramId: program.id,
      draft: program,
      error: "",
    });
  }

  _duplicateDraft() {
    if (!this._state.draft) {
      return;
    }
    const copy = this._clone(this._state.draft);
    copy.id = this._newId();
    copy.name = `${copy.name} Copy`;
    copy.blocks = copy.blocks.map((block) => ({ ...block, id: this._newId() }));
    this._setState({
      selectedProgramId: copy.id,
      draft: copy,
      error: "",
    });
  }

  _selectProgram(programId) {
    const program = this._state.programs.find((item) => item.id === programId);
    if (!program) {
      return;
    }
    this._setState({
      selectedProgramId: programId,
      draft: this._clone(program),
      error: "",
    });
  }

  _toggleWeekday(day) {
    if (!this._state.draft) {
      return;
    }
    const weekdays = new Set(this._state.draft.weekdays);
    if (weekdays.has(day)) {
      weekdays.delete(day);
    } else {
      weekdays.add(day);
    }
    this._state.draft.weekdays = [...weekdays].sort((left, right) => left - right);
    this._render();
  }

  _addBlock() {
    if (!this._state.draft) {
      return;
    }

    const firstEntity = this._state.entities[0] || null;
    const block = {
      id: this._newId(),
      label: firstEntity ? firstEntity.name : "New block",
      entity_id: firstEntity ? firstEntity.entity_id : "",
      offset_minutes: 0,
      duration_minutes: 15,
      start_service: firstEntity ? firstEntity.default_start_service : "switch.turn_on",
      stop_service: firstEntity ? firstEntity.default_stop_service : "switch.turn_off",
      color: "#c86c3d",
      service_data: {},
      stop_service_data: {},
    };

    this._state.draft.blocks = [...this._state.draft.blocks, block];
    this._render();
  }

  _removeBlock(blockId) {
    if (!this._state.draft) {
      return;
    }
    this._state.draft.blocks = this._state.draft.blocks.filter((block) => block.id !== blockId);
    this._render();
  }

  _handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;
    if (action === "create-program") {
      this._createProgram();
      return;
    }
    if (action === "select-program") {
      this._selectProgram(target.dataset.programId);
      return;
    }
    if (action === "save-program") {
      this._saveDraft();
      return;
    }
    if (action === "delete-program") {
      this._deleteDraft();
      return;
    }
    if (action === "run-program") {
      this._runDraft();
      return;
    }
    if (action === "stop-program") {
      this._stopDraft();
      return;
    }
    if (action === "duplicate-program") {
      this._duplicateDraft();
      return;
    }
    if (action === "toggle-weekday") {
      this._toggleWeekday(Number(target.dataset.day));
      return;
    }
    if (action === "add-block") {
      this._addBlock();
      return;
    }
    if (action === "remove-block") {
      this._removeBlock(target.dataset.blockId);
    }
  }

  _handleInput(event) {
    if (!this._state.draft) {
      return;
    }

    const target = event.target;
    const programField = target.dataset.programField;
    const blockField = target.dataset.blockField;

    if (programField) {
      const value = target.type === "checkbox" ? target.checked : target.value;
      this._state.draft[programField] = value;
      this._render();
      return;
    }

    if (blockField) {
      const block = this._state.draft.blocks.find((item) => item.id === target.dataset.blockId);
      if (!block) {
        return;
      }

      if (target.dataset.type === "number") {
        block[blockField] = Number(target.value || "0");
      } else if (target.dataset.type === "entity") {
        block[blockField] = target.value;
        const entity = this._state.entities.find((item) => item.entity_id === target.value);
        if (entity) {
          block.label = entity.name;
          block.start_service = entity.default_start_service;
          block.stop_service = entity.default_stop_service;
        }
      } else {
        block[blockField] = target.value;
      }

      this._render();
    }
  }

  _validateDraft(program) {
    if (!program.name || !program.name.trim()) {
      return "Program name is required.";
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(program.start_time)) {
      return "Start time must use HH:MM in 24 hour format.";
    }
    if (!Array.isArray(program.weekdays) || program.weekdays.length === 0) {
      return "Select at least one weekday.";
    }
    if (!Array.isArray(program.blocks) || program.blocks.length === 0) {
      return "Add at least one block.";
    }

    for (const block of program.blocks) {
      if (!block.entity_id) {
        return "Each block needs an entity.";
      }
      if (!block.start_service || !block.start_service.includes(".")) {
        return "Each block needs a valid start service.";
      }
      if (block.stop_service && !block.stop_service.includes(".")) {
        return "Stop services must use domain.service format.";
      }
      if (Number(block.offset_minutes) < 0 || Number(block.offset_minutes) > 1439) {
        return "Block offsets must be between 0 and 1439 minutes.";
      }
      if (Number(block.duration_minutes) < 1 || Number(block.duration_minutes) > 1440) {
        return "Block durations must be between 1 and 1440 minutes.";
      }
      if (Number(block.offset_minutes) + Number(block.duration_minutes) > 1440) {
        return "A block cannot run more than 24 hours from the program start.";
      }
    }

    return "";
  }

  _isRunning(programId) {
    return this._state.runningProgramIds.includes(programId);
  }

  _entityName(entityId) {
    const entity = this._state.entities.find((item) => item.entity_id === entityId);
    return entity ? entity.name : entityId;
  }

  _formatMinutes(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mins = String(normalized % 60).padStart(2, "0");
    return `${hours}:${mins}`;
  }

  _programBaseMinutes(program) {
    const [hours, minutes] = program.start_time.split(":").map((value) => Number(value));
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

  _timelineRows(program) {
    return [...program.blocks]
      .sort((left, right) => left.offset_minutes - right.offset_minutes)
      .map((block) => {
        const absoluteStart = this._programBaseMinutes(program) + Number(block.offset_minutes);
        const absoluteEnd = absoluteStart + Number(block.duration_minutes);
        const label = `${this._formatMinutes(absoluteStart)}-${this._formatMinutes(absoluteEnd)}${
          absoluteEnd >= 1440 ? " (+1d)" : ""
        }`;
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
          <div class="timeline-row">
            <div class="timeline-meta">
              <strong>${this._escape(block.label || this._entityName(block.entity_id))}</strong>
              <span>${this._escape(block.entity_id)}</span>
            </div>
            <div class="timeline-track">
              ${segments}
            </div>
            <div class="timeline-range">${this._escape(label)}</div>
          </div>
        `;
      })
      .join("");
  }

  _renderProgramList() {
    return this._state.programs
      .map((program) => {
        const selected = program.id === this._state.selectedProgramId;
        const running = this._isRunning(program.id);
        const nextRun = this._state.nextRuns[program.id];
        return `
          <button
            class="program-card ${selected ? "selected" : ""}"
            data-action="select-program"
            data-program-id="${this._escape(program.id)}"
          >
            <span class="program-name">${this._escape(program.name)}</span>
            <span class="program-meta">
              ${program.enabled ? "Enabled" : "Disabled"} · ${this._escape(program.start_time)}
            </span>
            <span class="program-meta">
              ${running ? "Running now" : nextRun ? `Next ${this._escape(nextRun)}` : "No next run"}
            </span>
          </button>
        `;
      })
      .join("");
  }

  _renderWeekdayButtons(program) {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return labels
      .map((label, index) => {
        const active = program.weekdays.includes(index);
        return `
          <button
            type="button"
            class="weekday ${active ? "active" : ""}"
            data-action="toggle-weekday"
            data-day="${index}"
          >
            ${label}
          </button>
        `;
      })
      .join("");
  }

  _renderEntityOptions(selectedEntityId) {
    const options = this._state.entities.map((entity) => {
      const selected = entity.entity_id === selectedEntityId ? "selected" : "";
      return `
        <option value="${this._escape(entity.entity_id)}" ${selected}>
          ${this._escape(entity.name)} (${this._escape(entity.entity_id)})
        </option>
      `;
    });

    if (options.length === 0) {
      options.unshift('<option value="">No supported entities found</option>');
    }

    return options.join("");
  }

  _renderBlockTable(program) {
    return program.blocks
      .map(
        (block) => `
          <div class="block-card">
            <div class="block-grid">
              <label>
                <span>Label</span>
                <input
                  type="text"
                  value="${this._escape(block.label)}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="label"
                />
              </label>

              <label>
                <span>Entity</span>
                <select
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="entity_id"
                  data-type="entity"
                >
                  ${this._renderEntityOptions(block.entity_id)}
                </select>
              </label>

              <label>
                <span>Offset (min)</span>
                <input
                  type="number"
                  min="0"
                  max="1439"
                  value="${Number(block.offset_minutes)}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="offset_minutes"
                  data-type="number"
                />
              </label>

              <label>
                <span>Duration (min)</span>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value="${Number(block.duration_minutes)}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="duration_minutes"
                  data-type="number"
                />
              </label>

              <label>
                <span>Start service</span>
                <input
                  type="text"
                  value="${this._escape(block.start_service || "")}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="start_service"
                />
              </label>

              <label>
                <span>Stop service</span>
                <input
                  type="text"
                  value="${this._escape(block.stop_service || "")}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="stop_service"
                />
              </label>

              <label>
                <span>Color</span>
                <input
                  type="color"
                  value="${this._escape(block.color || "#4f7f52")}"
                  data-block-id="${this._escape(block.id)}"
                  data-block-field="color"
                />
              </label>
            </div>

            <div class="block-actions">
              <button
                type="button"
                class="ghost danger"
                data-action="remove-block"
                data-block-id="${this._escape(block.id)}"
              >
                Remove block
              </button>
            </div>
          </div>
        `
      )
      .join("");
  }

  _renderEditor() {
    const program = this._state.draft;
    if (!program) {
      return `
        <section class="empty-editor">
          <h2>Build your first outdoor program</h2>
          <p>
            Create a schedule for irrigation valves, lights, switches and scenes.
            The timeline updates live as you edit.
          </p>
          <button class="primary" data-action="create-program">Create program</button>
        </section>
      `;
    }

    const running = this._isRunning(program.id);
    const timeline = program.blocks.length ? this._timelineRows(program) : "<p>No blocks yet.</p>";

    return `
      <section class="editor-shell">
        <div class="hero">
          <div>
            <p class="eyebrow">Visual schedule builder</p>
            <h1>${this._escape(program.name)}</h1>
            <p class="hero-copy">
              Weekly outdoor automation with a single program start time and block offsets.
            </p>
          </div>
          <div class="hero-badges">
            <span class="badge ${program.enabled ? "enabled" : "disabled"}">
              ${program.enabled ? "Enabled" : "Disabled"}
            </span>
            <span class="badge ${running ? "running" : "idle"}">
              ${running ? "Running" : "Idle"}
            </span>
          </div>
        </div>

        <div class="toolbar">
          <button class="primary" data-action="save-program">${this._state.saving ? "Saving..." : "Save"}</button>
          <button class="secondary" data-action="run-program">Run now</button>
          <button class="secondary" data-action="stop-program">Stop</button>
          <button class="ghost" data-action="duplicate-program">Duplicate</button>
          <button class="ghost danger" data-action="delete-program">Delete</button>
        </div>

        <section class="panel-card settings-grid">
          <label>
            <span>Name</span>
            <input
              type="text"
              value="${this._escape(program.name)}"
              data-program-field="name"
            />
          </label>

          <label>
            <span>Start time</span>
            <input
              type="time"
              value="${this._escape(program.start_time)}"
              data-program-field="start_time"
            />
          </label>

          <label class="toggle">
            <span>Enabled</span>
            <input
              type="checkbox"
              ${program.enabled ? "checked" : ""}
              data-program-field="enabled"
            />
          </label>
        </section>

        <section class="panel-card">
          <div class="section-head">
            <h2>Weekdays</h2>
            <p>Choose when the program should trigger.</p>
          </div>
          <div class="weekday-row">${this._renderWeekdayButtons(program)}</div>
        </section>

        <section class="panel-card timeline-card">
          <div class="section-head">
            <h2>Timeline</h2>
            <p>24-hour preview based on program start time plus block offsets.</p>
          </div>
          <div class="hours">
            ${Array.from({ length: 24 }, (_, hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("")}
          </div>
          <div class="timeline-rows">${timeline}</div>
        </section>

        <section class="panel-card">
          <div class="section-head split">
            <div>
              <h2>Blocks</h2>
              <p>Each block targets an entity and duration.</p>
            </div>
            <button class="secondary" data-action="add-block">Add block</button>
          </div>
          <div class="block-stack">${this._renderBlockTable(program)}</div>
        </section>
      </section>
    `;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _newId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `gf_${Math.random().toString(16).slice(2)}`;
  }

  _render() {
    const programsMarkup = this._renderProgramList();
    const editorMarkup = this._renderEditor();
    const errorBanner = this._state.error
      ? `<div class="error-banner">${this._escape(this._state.error)}</div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          color: var(--primary-text-color);
          display: block;
          min-height: 100%;
          font-family: "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .app {
          min-height: 100vh;
          padding: 24px;
          background:
            radial-gradient(circle at top left, rgba(202, 223, 179, 0.9), transparent 28%),
            radial-gradient(circle at top right, rgba(230, 176, 129, 0.55), transparent 24%),
            linear-gradient(180deg, #f6f1e7 0%, #ece4d6 100%);
        }

        .layout {
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 20px;
        }

        .sidebar,
        .editor-shell,
        .empty-editor {
          background: rgba(255, 252, 247, 0.86);
          border: 1px solid rgba(77, 74, 54, 0.1);
          border-radius: 24px;
          box-shadow: 0 16px 40px rgba(74, 58, 34, 0.08);
          backdrop-filter: blur(10px);
        }

        .sidebar {
          padding: 20px;
          position: sticky;
          top: 24px;
          height: fit-content;
        }

        .sidebar-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .sidebar-head h2,
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }

        .subtle {
          color: #6b6656;
          font-size: 0.95rem;
        }

        .program-stack {
          display: grid;
          gap: 10px;
        }

        .program-card {
          border: 1px solid rgba(77, 74, 54, 0.12);
          background: #fffdf8;
          border-radius: 18px;
          padding: 14px;
          text-align: left;
          cursor: pointer;
          display: grid;
          gap: 6px;
          transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        }

        .program-card:hover {
          transform: translateY(-1px);
          border-color: rgba(92, 124, 88, 0.45);
          box-shadow: 0 10px 20px rgba(79, 127, 82, 0.08);
        }

        .program-card.selected {
          border-color: #4f7f52;
          background: linear-gradient(180deg, #f7fbf4 0%, #eef6e8 100%);
        }

        .program-name {
          font-weight: 700;
          color: #302b21;
        }

        .program-meta {
          color: #6b6656;
          font-size: 0.86rem;
        }

        .editor-shell,
        .empty-editor {
          padding: 24px;
        }

        .hero {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 18px;
        }

        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 0.75rem;
          color: #6b6656;
          margin-bottom: 8px;
        }

        h1 {
          color: #2f3024;
          font-size: clamp(1.8rem, 3vw, 2.5rem);
          line-height: 1;
        }

        .hero-copy {
          margin-top: 10px;
          max-width: 680px;
          color: #5f594b;
          line-height: 1.5;
        }

        .hero-badges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .badge {
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 0.82rem;
          font-weight: 700;
          border: 1px solid transparent;
        }

        .badge.enabled,
        .badge.idle {
          background: rgba(122, 162, 110, 0.12);
          color: #355938;
          border-color: rgba(122, 162, 110, 0.25);
        }

        .badge.disabled {
          background: rgba(130, 114, 86, 0.12);
          color: #594a35;
          border-color: rgba(130, 114, 86, 0.2);
        }

        .badge.running {
          background: rgba(200, 108, 61, 0.14);
          color: #8e4d2a;
          border-color: rgba(200, 108, 61, 0.26);
        }

        .toolbar {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        button {
          border: none;
          border-radius: 14px;
          padding: 12px 16px;
          font: inherit;
          cursor: pointer;
        }

        .primary {
          background: linear-gradient(135deg, #426f46 0%, #5b915e 100%);
          color: white;
          box-shadow: 0 10px 24px rgba(79, 127, 82, 0.22);
        }

        .secondary {
          background: #f3e6d6;
          color: #5b412d;
          border: 1px solid rgba(139, 94, 60, 0.12);
        }

        .ghost {
          background: transparent;
          border: 1px solid rgba(77, 74, 54, 0.16);
          color: #4b4538;
        }

        .danger {
          color: #8b3f32;
          border-color: rgba(139, 63, 50, 0.18);
        }

        .panel-card {
          border: 1px solid rgba(77, 74, 54, 0.1);
          background: rgba(255, 255, 255, 0.78);
          border-radius: 20px;
          padding: 18px;
          margin-bottom: 16px;
        }

        .section-head {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 14px;
        }

        .section-head.split {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }

        .section-head h2 {
          color: #2f3024;
          font-size: 1.15rem;
        }

        .section-head p {
          color: #6b6656;
          line-height: 1.45;
        }

        .settings-grid,
        .block-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        label {
          display: grid;
          gap: 8px;
          color: #4f493b;
          font-size: 0.92rem;
        }

        label span {
          font-weight: 600;
        }

        input,
        select {
          width: 100%;
          border: 1px solid rgba(77, 74, 54, 0.14);
          border-radius: 12px;
          padding: 11px 12px;
          background: #fffefb;
          color: #2f3024;
          font: inherit;
        }

        .toggle {
          align-items: center;
          grid-template-columns: 1fr auto;
        }

        .toggle input {
          width: 24px;
          height: 24px;
          padding: 0;
        }

        .weekday-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .weekday {
          background: #f7f1e7;
          color: #62584a;
          border: 1px solid rgba(77, 74, 54, 0.12);
          min-width: 60px;
        }

        .weekday.active {
          background: linear-gradient(135deg, #c86c3d 0%, #d98c4f 100%);
          color: white;
          border-color: transparent;
        }

        .timeline-card {
          overflow: hidden;
        }

        .hours {
          display: grid;
          grid-template-columns: repeat(24, minmax(0, 1fr));
          gap: 0;
          color: #796f60;
          font-size: 0.8rem;
          margin-bottom: 12px;
        }

        .hours span {
          text-align: center;
        }

        .timeline-rows {
          display: grid;
          gap: 12px;
        }

        .timeline-row {
          display: grid;
          grid-template-columns: 220px minmax(0, 1fr) 100px;
          gap: 12px;
          align-items: center;
        }

        .timeline-meta {
          display: grid;
          gap: 3px;
        }

        .timeline-meta span,
        .timeline-range {
          color: #6b6656;
          font-size: 0.86rem;
        }

        .timeline-track {
          position: relative;
          min-height: 26px;
          border-radius: 999px;
          background:
            repeating-linear-gradient(
              90deg,
              rgba(102, 94, 79, 0.08) 0,
              rgba(102, 94, 79, 0.08) calc(100% / 24),
              rgba(255, 255, 255, 0.5) calc(100% / 24),
              rgba(255, 255, 255, 0.5) calc(100% / 12)
            );
          overflow: hidden;
          border: 1px solid rgba(77, 74, 54, 0.08);
        }

        .segment {
          position: absolute;
          top: 3px;
          bottom: 3px;
          border-radius: 999px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
        }

        .block-stack {
          display: grid;
          gap: 14px;
        }

        .block-card {
          border: 1px solid rgba(77, 74, 54, 0.08);
          border-radius: 18px;
          background: #fffefb;
          padding: 14px;
        }

        .block-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 12px;
        }

        .empty-editor {
          display: grid;
          gap: 14px;
          place-items: start;
        }

        .error-banner {
          margin-bottom: 16px;
          padding: 12px 14px;
          background: rgba(165, 69, 53, 0.12);
          color: #8b3f32;
          border: 1px solid rgba(165, 69, 53, 0.18);
          border-radius: 16px;
        }

        .loading {
          color: #6b6656;
          padding: 18px 0;
        }

        @media (max-width: 1100px) {
          .layout {
            grid-template-columns: 1fr;
          }

          .sidebar {
            position: static;
          }

          .timeline-row {
            grid-template-columns: 1fr;
          }

          .timeline-range {
            margin-top: -6px;
          }
        }

        @media (max-width: 780px) {
          .app {
            padding: 14px;
          }

          .settings-grid,
          .block-grid {
            grid-template-columns: 1fr;
          }

          .hero {
            flex-direction: column;
          }

          .toolbar {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      </style>

      <div class="app">
        ${errorBanner}
        <div class="layout">
          <aside class="sidebar">
            <div class="sidebar-head">
              <div>
                <h2>Programs</h2>
                <p class="subtle">Irrigation, lights and outdoor routines.</p>
              </div>
              <button class="primary" data-action="create-program">New</button>
            </div>
            ${
              this._state.loading
                ? '<p class="loading">Loading programs...</p>'
                : `<div class="program-stack">${programsMarkup || '<p class="subtle">No programs yet.</p>'}</div>`
            }
          </aside>

          <main>
            ${editorMarkup}
          </main>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("garden-flow-panel")) {
  customElements.define("garden-flow-panel", GardenFlowPanel);
}
