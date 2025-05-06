function createDragHandle() {
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    return handle
}

function createDeleteButton() {
    const deleteButton = document.createElement("button")
    deleteButton.className = "delete-button";
    return deleteButton
}

export class SplitTextField {
    constructor(container) {
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
        this.setValue(fromAttr);
    }

    _createHeader() {
        const header = document.createElement("div");
        header.className = "split-header";
        const input = document.createElement("input");
        const toggle = document.createElement("button");
        toggle.className = "toggle-button";
        const handle = createDragHandle();
        const deleteButton = createDeleteButton()
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

export class RangedAttack {
    constructor(container) {
        this.container = container;

        if (
            container &&
            container.classList.contains('ranged-attack') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        this.deleteButton = this.container.querySelector(".delete-button")
        this.deleteButton.addEventListener("click", () => this.container.remove());

        this.container.addEventListener('paste', e => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const target = e.target;

            const isNameField = target?.dataset?.id === "name";
            const hasNewline = text.includes('\n');

            if (isNameField && hasNewline) {
                e.preventDefault();
                this.populateRangedAttack(text);
            }
        });
    }

    buildStructure() {
        this.container.innerHTML = `
        <div class="layout-row">
          <div class="layout-row name">
            <label>Name:</label>
            <input class="long-input" data-id="name" />
          </div>
          <div class="layout-row class">
            <label>Class:</label>
            <select data-id="class">
              <option value="pistol">Pistol</option>
              <option value="rifle">Rifle</option>
              <option value="long rifle">Long Rifle</option>
              <option value="heavy">Heavy</option>
              <option value="throwing">Throwing</option>
              <option value="grenade">Grenade</option>
            </select>
            <div class="drag-handle"></div>
            <button class="delete-button"></button>
          </div>
        </div>
  
        <div class="layout-row">
          <div class="layout-row range">
            <label>Range:</label>
            <input data-id="range" />
          </div>
          <div class="layout-row damage">
            <label>Damage:</label>
            <input data-id="damage" />
          </div>
          <div class="layout-row pen">
            <label>Pen:</label>
            <input data-id="pen" />
          </div>
          <div class="layout-row type">
            <label>Type:</label>
            <select data-id="type">
              <option value="impact">Impact</option>
              <option value="rending">Rending</option>
              <option value="explosive">Explosive</option>
              <option value="energy">Energy</option>
              <option value="chem">Chem</option>
            </select>
          </div>
        </div>
  
        <div class="layout-row">
          <div class="layout-row rof">
            <label>RoF:</label>
            <input data-id="rof-single" />/
            <input class="shorter-input" data-id="rof-short" />/
            <input class="shorter-input" data-id="rof-long" />
          </div>
          <div class="layout-row clip">
            <label>Clip:</label>
            <input data-id="clip-cur" />/
            <input data-id="clip-max" />
          </div>
          <div class="layout-row reload">
            <label>Reload:</label>
            <input data-id="reload" />
          </div>
        </div>
  
        <div class="layout-row">
          <div class="layout-row special">
            <label>Special:</label>
            <input data-id="special" />
          </div>
        </div>
      `;
    }

    // Populate field values from pasted string
    populateRangedAttack(paste) {
        const container = this.container;
        // Some rows have alt profiles in [], like Legion version
        const curedPaste = paste.replace(/\r?\n?\[.*?\]/g, '');
        const lines = curedPaste.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        // 1) Name = lines[0] + lines[1] + lines[2]
        // const name = lines.slice(0, 3).join(" ");
        const name = lines[0];

        // 2) Everything else is on line 4 and further
        //    CLASS  RANGE   RoF     DMG       TYPE  PEN   CLIP-CUR  CLIP-MAX  RLD   [special…]
        // e.g. ["пистолет","15м","S/–/–","1d10+2","I","0","1","3", "Primitive,","…"]
        const parts = lines.slice(3).join(" ").split(/\s+/);

        let i = 0;
        // parts[0]=class, [1]=range, [2]=RoF
        const rawClass = parts[i++];
        const range = parts[i++];
        const rofAll = parts[i++];

        // 3) Damage
        const damage = parts[i++];

        // 4) Damage-type: only consume if it’s a known letter
        const typeMap = { I: "impact", R: "rending", E: "explosive", N: "energy", C: "chem" };
        let damageType;
        const re = /^(?:\d+d(?:10|5)\+\d+|\d+)$/;
        if (re.test(damage)) {
            damageType = typeMap[parts[i++].toUpperCase()] || "impact";
        }

        // 5) Pen
        const pen = parts[i++];

        // 6) Clip-max
        const clipMax = parts[i++];

        // 7) Reload (may be omitted)
        let reload = parts[i++]

        // 8) Special / weight / recoil
        //    find the weight token (contains “кг” or “kg”)
        const rest = parts.slice(i);

        // --- CLASS mapping Russian → option value
        const classMap = {
            "пистолет": "pistol",
            "винтовка": "rifle",
            "длинная винтовка": "long rifle",
            "тяжелое": "heavy",
            "метательное": "throwing",
            "граната": "grenade",
        };
        const clsValue = classMap[rawClass.toLowerCase()] || rawClass;

        container.querySelector('input[data-id="name"]').value = name;
        container.querySelector('select[data-id="class"]').value = clsValue;

        // --- RANGE, DAMAGE, PEN
        container.querySelector('input[data-id="range"]').value = range;
        container.querySelector('input[data-id="damage"]').value = damage;
        container.querySelector('input[data-id="pen"]').value = pen;
        container.querySelector('select[data-id="type"]').value = damageType;

        // --- RoF split
        const [rofSingle, rofShort, rofLong] = rofAll.split("/");
        container.querySelector('input[data-id="rof-single"]').value = rofSingle;
        container.querySelector('input[data-id="rof-short"]').value = rofShort;
        container.querySelector('input[data-id="rof-long"]').value = rofLong;

        // --- Clip & Reload
        container.querySelector('input[data-id="clip-cur"]').value = clipMax;
        container.querySelector('input[data-id="clip-max"]').value = clipMax;
        container.querySelector('input[data-id="reload"]').value = reload;

        // --- Special traits: everything before weight & rarity
        const traits = rest
            .slice(0, rest.length - 2)
            .join(" ")
            .replace(/,\s*/g, ", ")
            .trim()
            .replace(/,\s*$/, '');
        container.querySelector('input[data-id="special"]').value = traits;
    }
}

export class MeleeAttack {
    constructor(container) {
        this.container = container;

        if (
            container &&
            container.classList.contains('melee-attack') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        this.deleteButton = this.container.querySelector(".delete-button")
        this.deleteButton.addEventListener("click", () => this.container.remove());
    }

    buildStructure() {
        this.container.innerHTML = `
        <div class="layout-row">
            <div class="layout-row name">
                <label>Name:</label>
                <input class="long-input" data-id="name" />
            </div>
            <div class="layout-row class">
                <label>Class:</label>
                <span>Melee</span>
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>
        </div>

        <div class="layout-row">
            <div class="layout-row range">
                <label>Range:</label>
                <input data-id="range" />
            </div>
            <div class="layout-row damage">
                <label>Damage:</label>
                <input data-id="damage" />
            </div>
            <div class="layout-row pen">
                <label>Pen:</label>
                <input data-id="pen" />
            </div>
            <div class="layout-row type">
                <label>Type:</label>
                <select data-id="type">
                    <option value="impact">Impact</option>
                    <option value="rending">Rending</option>
                    <option value="explosive">Explosive</option>
                    <option value="energy">Energy</option>
                    <option value="chem">Chem</option>
                </select>
            </div>
        </div>

        <div class="layout-row">
            <div class="layout-row special">
                <label>Special:</label>
                <input data-id="special" />
            </div>
        </div>
      `;
    }
}
