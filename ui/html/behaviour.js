export function makeDeletable(gridEl) {
    let deletionMode = false;
    gridEl
        .querySelector(".toggle-delete-mode")
        .addEventListener("click", () => {
            deletionMode = !deletionMode;
            gridEl.classList.toggle("deletion-mode", deletionMode);
        });
}


export function createIdCounter(gridEl, itemSelector) {
    let lastId = 0; // Stores the last used ID for this specific grid

    // Initially scan the grid to find the highest ID
    gridEl.querySelectorAll(itemSelector).forEach((item) => {
        const [, num] = item.dataset.id.split("-");
        const n = parseInt(num, 10);
        if (!isNaN(n) && n > lastId) lastId = n;
    });

    // Return the closure that gives you the next ID
    return function () {
        lastId += 1;
        return lastId;
    };
}

export function setupToggleAll(itemGridInstance) {
    const { grid, cssClassName } = itemGridInstance;

    grid.querySelector(".toggle-all")?.addEventListener("click", () => {
        const shouldOpen = Array.from(
            grid.querySelectorAll(".split-textarea:not(:placeholder-shown)")
        ).some((ta) => !ta.classList.contains("visible"));

        const sel = shouldOpen
            ? `${cssClassName}:has(.split-textarea:not(:placeholder-shown)):not(:has(.split-textarea.visible))`
            : `${cssClassName}:has(.split-textarea.visible)`;

        grid.querySelectorAll(sel).forEach((item) => {
            item.dispatchEvent(
                new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
            );
        });
    });
}

export function setupGlobalAddButton(itemGridInstance) {
    const { grid, cssClassName, _createNewItem } = itemGridInstance;

    grid.querySelector(".add-one")?.addEventListener("click", () => {
        const wrappers = Array.from(
            grid.querySelectorAll(".layout-column-wrapper")
        );

        let target = null;
        let min = Infinity;

        wrappers.forEach((wrapper) => {
            const col = wrapper.querySelector(".layout-column");
            const count = col.querySelectorAll(cssClassName).length;
            if (count < min) {
                min = count;
                target = col;
            }
        });

        if (target) _createNewItem.call(itemGridInstance, target);
    });
}


export function setupColumnAddButtons(itemGridInstance) {
    const { grid, _createNewItem } = itemGridInstance;

    grid.querySelectorAll(".add-button").forEach((btn) => {
        btn.addEventListener("click", () => {
            const col = btn
                .closest(".layout-column-wrapper")
                .querySelector(".layout-column");

            _createNewItem.call(itemGridInstance, col);
        });
    });
}


export function makeSortable(itemGridInstance) {
    const { grid } = itemGridInstance;

    grid.querySelectorAll(".layout-column").forEach((col) => {
        new Sortable(col, {
            group: grid.id,
            handle: ".drag-handle",
            animation: 150,
            ghostClass: "sortable-ghost",
        });
    });
}

