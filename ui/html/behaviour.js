export function makeDeletable(itemOrGrid) {
    const grid = itemOrGrid instanceof Element
        ? itemOrGrid
        : itemOrGrid.grid;
    let deletionMode = false;

    let toggleButton = grid.querySelector('.toggle-delete-mode');

    if (!toggleButton) {
        const controls = grid.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-delete-mode';
        toggleButton.textContent = 'Delete Mode';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener('click', () => {
        deletionMode = !deletionMode;
        grid.classList.toggle('deletion-mode', deletionMode);
    });
}


// TO DO: Use bundler
import { nanoid } from 'https://cdn.jsdelivr.net/npm/nanoid/nanoid.js'

export function createIdCounter(gridEl, itemSelector) {
    // Return the closure that gives you the next ID
    return function () {
        return nanoid();
    };
}

export function setupToggleAll(itemGridInstance) {
    const { grid, cssClassName } = itemGridInstance;

    let toggleButton = grid.querySelector('.toggle-all');

    if (!toggleButton) {
        const controls = grid.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-all';
        toggleButton.textContent = 'Toggle All';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener("click", () => {
        const shouldOpen = Array.from(
            grid.querySelectorAll(".split-description:not(:placeholder-shown)")
        ).some((ta) => !ta.classList.contains("visible"));

        const sel = shouldOpen
            ? `${cssClassName}:has(.split-description:not(:placeholder-shown)):not(:has(.split-description.visible))`
            : `${cssClassName}:has(.split-description.visible)`;

        grid.querySelectorAll(sel).forEach((item) => {
            item.dispatchEvent(
                new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
            );
        });
    });
}

export function setupGlobalAddButton(itemGridInstance) {
    const { grid, cssClassName, _createNewItem } = itemGridInstance;

    let addButton = grid.querySelector('.add-one');

    if (!addButton) {
        const controls = grid.querySelector('.controls-block');
        addButton = document.createElement('button');
        addButton.className = 'add-one';
        addButton.textContent = '+ Add';
        controls.appendChild(addButton);
    }

    addButton.addEventListener("click", () => {
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

    grid.querySelectorAll('.add-slot').forEach(slot => {
        let btn = slot.querySelector('.add-button');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'add-button';
            btn.textContent = '＋ Add';
            slot.appendChild(btn);
        }

        if (!btn.dataset.handlerAttached) {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.layout-column-wrapper');
                const col = wrapper && wrapper.querySelector('.layout-column');
                if (col) {
                    _createNewItem.call(itemGridInstance, col);
                }
            });
            btn.dataset.handlerAttached = 'true';
        }
    });
}


export function makeSortable(itemGridInstance) {
    const { grid, sortableChildrenSelectors } = itemGridInstance;

    grid.querySelectorAll(".layout-column").forEach((col) => {
        new Sortable(col, {
            group: grid.id,
            handle: ".drag-handle",
            animation: 150,
            filter: sortableChildrenSelectors,
            ghostClass: "sortable-ghost",
        });
    });
}

