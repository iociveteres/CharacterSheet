import {
    makeDeletable,
    setupToggleAll,
    initChangeHandler,
    initBatchHandler,
    setupHandleEnter,
} from "./behaviour.js"

import {
    getRoot
} from "./utils.js"

import {
    Autocomplete
} from "./autocomplete.js"

import {
    socket
} from "./network.js"

import {
    initState
} from "./state/state.js"

import {
    mountBindings
} from "./state/bindings.js"

import {
    getSheetKind,
    getKindModule
} from "./kinds/index.js"


function lockUneditableInputs(root) {
    root.querySelectorAll('.uneditable').forEach(el => {
        el.setAttribute('readonly', '');
        el.setAttribute('tabindex', '-1');

        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('focus', e => el.blur());
    });
}

function initCopyable(root) {
    root.querySelectorAll('.copyable').forEach(el => {
        el.addEventListener('click', async () => {
            await navigator.clipboard.writeText(el.textContent);

            el.classList.remove('copied');

            void el.offsetWidth;

            el.classList.add('copied');

            clearTimeout(el._copyTimeout);

            el._copyTimeout = setTimeout(() => {
                el.classList.remove('copied');
            }, 800);
        });
    });
}


document.addEventListener('charactersheet_inserted', () => {
    const root = getRoot();
    if (!root) {
        return
    }

    initState(root);
    mountBindings(root);

    makeDeletable(root.querySelector(".container"))
    setupToggleAll(root.querySelector(".container"))
    setupHandleEnter()

    const socketConnection = socket
    initChangeHandler()
    initBatchHandler()

    const autocomplete = new Autocomplete({ socket: socketConnection, root });

    // Which blocks the sheet has depends on its kind, so the kind module owns
    // their init sequence.
    const kind = getSheetKind();
    const kindModule = getKindModule(kind);
    if (kindModule) {
        kindModule.init({ root, socket: socketConnection, autocomplete });
    } else {
        // Blocks stay uninitialized, but the sheet must still not look editable
        // to someone who cannot edit it.
        console.error(`No init module for sheet kind "${kind}"`);
    }

    lockUneditableInputs(root);
    initCopyable(root);
});
