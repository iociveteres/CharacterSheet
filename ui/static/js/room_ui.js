function createCharacterEntry(msg) {
    if (!msg || typeof msg.userID === 'undefined') {
        console.warn('createCharacterEntry: missing msg or userID', msg);
        return;
    }

    const playersContainer = document.getElementById('players');
    if (!playersContainer) {
        console.warn('#players container not found');
        return;
    }

    const player = playersContainer.querySelector(`.player[data-user-id="${msg.userID}"]`);
    if (!player) {
        console.warn('#players container not found');
    }

    const sheetId = msg.sheetID;
    const sheetUrl = `/sheet/view/${sheetId}`;

    const entry = document.createElement('div');
    entry.className = 'character-sheet-entry';
    entry.setAttribute('data-sheet-id', sheetId);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'name';
    const a = document.createElement('a');
    a.href = sheetUrl;
    a.textContent = msg.name || 'Unnamed character';
    nameWrap.appendChild(a);

    const createdMeta = document.createElement('div');
    createdMeta.className = 'meta created';
    createdMeta.textContent = `Created ${msg.created}`;

    const updatedMeta = document.createElement('div');
    updatedMeta.className = 'meta updated';
    updatedMeta.textContent = `Modified ${msg.updated}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-sheet';
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';

    entry.appendChild(nameWrap);
    entry.appendChild(createdMeta);
    entry.appendChild(updatedMeta);
    entry.appendChild(delBtn);

    player.appendChild(entry);
    return entry;
}

function deleteCharacterEntry(msg) {
    const el = document.querySelector(`.character-sheet-entry[data-sheet-id="${msg.sheetID}"]`);
    if (el) {
        el.remove();
    }
}

const players = document.getElementById('players')
players.addEventListener('newCharacterSheetEntry', (e) => {
    createCharacterEntry(e.detail);
});

players.addEventListener('deleteCharacterSheetEntry', (e) => {
    deleteCharacterEntry(e.detail);
});

// new character button
const newCharacter = document.getElementById("new-character")
newCharacter.addEventListener("click", function () {
    const msg = JSON.stringify({
        type: 'newCharacter',
        eventID: crypto.randomUUID(),
    })

    document.dispatchEvent(new CustomEvent('createCharacterLocal', {
        detail: msg
    }));
});

// delete character button
players.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !players.contains(btn)) return;

    if (!btn.classList.contains('delete-sheet') && btn.dataset.action !== 'delete') return;

    const entry = btn.closest('.character-sheet-entry');
    if (!entry) return;

    const sheetId = entry.dataset.sheetId

    if (!sheetId) {
        console.warn('No sheet id found for delete button', entry);
        return;
    }

    const nameEl = entry.querySelector('.name a');
    const charName = nameEl ? nameEl.textContent.trim() : '(unnamed)';
    if (!confirm(`Delete ${charName}?`)) return;

    // prevent double sends
    if (btn.disabled || btn.classList.contains('deleting')) return;
    btn.disabled = true;
    btn.classList.add('deleting');

    const payload = {
        type: 'deleteCharacter',
        eventID: crypto.randomUUID(),
        sheetID: String(sheetId)
    };
    const data = JSON.stringify(payload);

    document.dispatchEvent(new CustomEvent('deleteCharacterLocal', {
        detail: data
    }));

    setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('deleting');
    }, 5_000);
});

function changeName(msg) {
    const name = document.querySelector(`.character-sheet-entry[data-sheet-id="${msg.sheetID}"] .name a`);
    name.textContent = msg.change;
}

players.addEventListener('nameChanged', (e) => {
    changeName(e.detail)
});
