import { Autocomplete } from "./autocomplete.js"

import {
    socket,
    sheetActions
} from "./network.js"

import {
    initState
} from "./state/state.js"

import {
    DEFAULT_SHEET_KIND
} from "./kinds/kinds.gen"

import {
    layoutOf
} from "./kinds/index"

import {
    onSheetTeardown,
    pendingTeardowns,
    teardownSheet
} from "./lifecycle"

import {
    mountSheet
} from "./Sheet"

import {
    readSheetState
} from "./state/sheetState"


document.addEventListener('charactersheet_inserted', () => {
    const host = document.getElementById('charactersheet');
    const root = host?.shadowRoot;
    if (!root) {
        return
    }

    // room.js fires charactersheet_removing before it replaces a sheet. Any
    // other way of replacing it would leave the old sheet's effects running.
    if (pendingTeardowns() > 0) {
        console.warn('The previous sheet was replaced without charactersheet_removing');
        teardownSheet();
    }

    const { content, canEdit } = readSheetState();
    initState(content);

    const kind = host.dataset.sheetKind ?? DEFAULT_SHEET_KIND;
    const Layout = layoutOf(kind);
    if (!Layout) {
        console.error(`No layout for sheet kind "${kind}"`);
        return;
    }

    const autocomplete = new Autocomplete({ socket, root });
    onSheetTeardown(() => autocomplete.destroy());

    mountSheet(root.getElementById('sheet-root'), {
        sheetId: host.dataset.sheetId,
        canEdit,
        actions: sheetActions,
        autocomplete,
    }, Layout);
});
