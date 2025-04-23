class SplitTextField {
    constructor(container, initialText = "") {
        this.container = container;

        // 1) If server already rendered the header & textarea, use them…
        this.header = container.querySelector(".split-header")
            || this._createHeader();
        this.input = this.header.querySelector("input");
        this.toggle = this.header.querySelector(".toggle-button");
        this.handle = this.header.querySelector(".drag-handle");
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
        handle.innerText = "☰";
        header.append(input, toggle, handle);
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
    constructor(gridEl) {
        this.grid = gridEl;
        this.nextId = this._initCounter();
        this._initFields();
        this._initSortable();
        this._initControls();
    }

    _initCounter() {
        const name = this.grid.id;
        let max = 0;
        this.grid.querySelectorAll(".item[data-id]").forEach((item) => {
            const [, num] = item.dataset.id.split("-");
            const n = parseInt(num, 10);
            if (!isNaN(n) && n > max) max = n;
        });
        return max + 1;
    }

    _initFields() {
        this.grid
            .querySelectorAll(".item")
            .forEach((el) => new SplitTextField(el, el.dataset.initial || ""));
    }

    _initSortable() {
        const groupName = this.grid.id;
        this.grid.querySelectorAll(".layout-column").forEach((col) => {
            new Sortable(col, {
                group: groupName,
                handle: ".drag-handle",
                animation: 150,
                ghostClass: "sortable-ghost",
                filter: ".add-slot",
                preventOnFilter: false,
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
                ? `.item:has(.split-textarea:not(:placeholder-shown)):not(:has(.split-textarea.visible))`
                : `.item:has(.split-textarea.visible)`;

            this.grid.querySelectorAll(sel).forEach((item) => {
                item.dispatchEvent(
                    new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
                );
            });
        });

        // "+ Add" (global)
        this.grid.querySelector(".add-item").addEventListener("click", () => {
            const wrappers = Array.from(
                this.grid.querySelectorAll(".layout-column-wrapper")
            );
            let target = null,
                min = Infinity;
            wrappers.forEach((w) => {
                const col = w.querySelector(".layout-column");
                const cnt = col.querySelectorAll(".item").length;
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
        const id = `${this.grid.id}-${this.nextId++}`;
        const div = document.createElement("div");
        div.className = "item";
        div.dataset.id = id;
        column.appendChild(div);
        new SplitTextField(div, "");
    }
}

document.querySelectorAll(".talent-grid").forEach((g) => new TalentGrid(g));
