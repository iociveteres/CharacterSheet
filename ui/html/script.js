import { makeDeletable, createIdCounter } from "./comm.js"

class SplitTextField {
    constructor(container, initialText = "") {
        this.container = container;

        // 1) If server already rendered the header & textarea, use them…
        this.header = container.querySelector(".split-header")
            || this._createHeader();
        this.input = this.header.querySelector("input");
        this.toggle = this.header.querySelector(".toggle-button");
        this.handle = this.header.querySelector(".drag-handle");
        this.deleteButton = this.header.querySelector(".delete-button")
        this.textarea = container.querySelector(".split-textarea")
            || this._createTextarea();

        // 2) Wire up split-toggle events
        container.addEventListener("split-toggle", (e) => {
            this.textarea.classList.toggle("visible", e.detail.open);
        });

        // 3) Events for splitting, toggling, dragging
        this.input.addEventListener("input", () => this.syncCombined());
        this.input.addEventListener("keydown", (e) => this.handleEnter(e));
        this.input.addEventListener("paste", (e) => this.handlePaste(e));
        this.textarea.addEventListener("input", () => this.syncCombined());
        this.textarea.addEventListener("paste", (e) => this.handlePaste(e));
        this.toggle.addEventListener("click", () => this.toggleTextarea());
        this.deleteButton.addEventListener("click", () => this.container.remove());

        // 4) Initialize from `data-initial` or passed-in text
        const fromAttr = container.dataset.initial || "";
        this.setValue(initialText || fromAttr);
    }

    _createHeader() {
        const header = document.createElement("div");
        header.className = "split-header";
        const input = document.createElement("input");
        const toggle = document.createElement("button");
        toggle.className = "toggle-button";
        const handle = document.createElement("div");
        handle.className = "drag-handle";
        const deleteButton = document.createElement("button")
        deleteButton.className = "delete-button";
        header.append(input, toggle, handle, deleteButton);
        this.container.append(header);
        return header;
    }

    _createTextarea() {
        const ta = document.createElement("textarea");
        ta.className = "split-textarea";
        ta.placeholder = " ";
        this.container.append(ta);
        return ta;
    }

    setValue(text) {
        const lines = text.replace("\\n", "\n").split("\n");
        this.input.value = lines[0] || "";
        this.textarea.value = lines.slice(1).join("\n");
        this.syncCombined();
    }

    syncCombined() {
        this.combined = this.input.value + "\n" + this.textarea.value;
    }

    toggleTextarea() {
        this.textarea.classList.toggle("visible");
    }

    handlePaste(e) {
        const paste = (e.clipboardData || window.clipboardData).getData("text");
        if (paste.includes("\n")) {
            e.preventDefault();
            this.setValue(paste);
            this.textarea.classList.add("visible");
        }
    }

    handleEnter(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            const pos = this.input.selectionStart;
            const before = this.input.value.slice(0, pos);
            const after = this.input.value.slice(pos);
            this.input.value = before;
            this.textarea.value = (after + "\n" + this.textarea.value).trim();
            this.textarea.classList.add("visible");
            this.syncCombined();
            this.textarea.focus();
            this.textarea.setSelectionRange(0, 0);
        }
    }
}

class TalentGrid {
    constructor(gridEl, cssClassName, FieldClass) {
        this.grid = gridEl;
        this.cssClassName = cssClassName;
        this.FieldClass = FieldClass

        this._initFields();
        this._initSortable();
        this._initControls();

        this.nextId = createIdCounter(this.grid, `${this.cssClassName}[data-id]`);
        makeDeletable(gridEl);
    }

    _initFields() {
        this.grid
            .querySelectorAll(this.cssClassName)
            .forEach(el => new this.FieldClass(el, ""));
    }

    _initSortable() {
        this.grid.querySelectorAll(".layout-column").forEach((col) => {
            new Sortable(col, {
                group: this.grid.id,
                handle: ".drag-handle",
                animation: 150,
                ghostClass: "sortable-ghost",
            });
        });
    }

    _initControls() {
        // Toggle All
        this.grid.querySelector(".toggle-all").addEventListener("click", () => {
            const shouldOpen = Array.from(
                this.grid.querySelectorAll(".split-textarea:not(:placeholder-shown)")
            ).some((ta) => !ta.classList.contains("visible"));

            const sel = shouldOpen
                ? `${this.cssClassName}:has(.split-textarea:not(:placeholder-shown)):not(:has(.split-textarea.visible))`
                : `${this.cssClassName}:has(.split-textarea.visible)`;

            this.grid.querySelectorAll(sel).forEach((item) => {
                item.dispatchEvent(
                    new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
                );
            });
        });

        // "+ Add" (global)
        this.grid.querySelector(".add-one").addEventListener("click", () => {
            const wrappers = Array.from(
                this.grid.querySelectorAll(".layout-column-wrapper")
            );
            let target = null,
                min = Infinity;
            wrappers.forEach((w) => {
                const col = w.querySelector(".layout-column");
                const cnt = col.querySelectorAll(`${this.cssClassName}`).length;
                if (cnt < min) (min = cnt), (target = col);
            });
            if (target) this._createNewItem(target);
        });

        // "+ Add" (per-column)
        this.grid.querySelectorAll(".add-button").forEach((btn) => {
            btn.addEventListener("click", () => {
                const col = btn
                    .closest(".layout-column-wrapper")
                    .querySelector(".layout-column");
                this._createNewItem(col);
            });
        });
    }

    _createNewItem(column) {
        const id = `${this.grid.id}-${this.nextId()}`;
        const div = document.createElement("div");
        div.className = this.cssClassName.replace(/^\./, ""); // strip leading “.” if you prefer
        div.dataset.id = id;
        column.appendChild(div);
        new this.FieldClass(div, "");
    }
}

new TalentGrid(document.querySelector("#talents"), ".split-text-field", SplitTextField);
new TalentGrid(document.querySelector("#traits"), ".split-text-field", SplitTextField);
