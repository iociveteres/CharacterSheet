function createCharacterEntry(msg) {
    if (!msg || typeof msg.userID === 'undefined') {
        console.warn('createCharacterEntry: missing msg or userID', msg);
        return;
    }

    const charactersContainer = document.getElementById('characters');
    if (!charactersContainer) {
        console.warn('#players container not found');
        return;
    }

    const player = charactersContainer.querySelector(`.player[data-user-id="${msg.userID}"]`);
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

    const sheetControls = document.createElement("div");
    sheetControls.className = "sheet-controls";
    const button = document.createElement("button");
    button.className = "delete-sheet";
    button.type = "button";
    sheetControls.appendChild(button);

    entry.appendChild(nameWrap);
    entry.appendChild(createdMeta);
    entry.appendChild(updatedMeta);
    entry.appendChild(sheetControls);

    player.insertBefore(entry, player.querySelector(".player-name").nextSibling);
    return entry;
}

function deleteCharacterEntry(msg) {
    const el = document.querySelector(`.character-sheet-entry[data-sheet-id="${msg.sheetID}"]`);
    if (el) {
        el.remove();
    }
    const charactersheet = document.getElementById('charactersheet');
    if (msg.sheetID == charactersheet?.dataset?.sheetId) {
        charactersheet.remove();
    }
}

const characters = document.getElementById('characters')
characters.addEventListener('newCharacterSheetEntry', (e) => {
    createCharacterEntry(e.detail);
});

characters.addEventListener('deleteCharacterSheetEntry', (e) => {
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
characters.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !characters.contains(btn)) return;

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

characters.addEventListener('nameChanged', (e) => {
    changeName(e.detail)
});


const newInviteLink = document.getElementById("create-new-invite-link")
newInviteLink.addEventListener("click", function () {
    const expiresSelect = document.getElementById("link-expires-in");
    const maxUsesInput = document.getElementById("link-max-uses");

    // Read selected values
    const expiresInDays = parseInt(expiresSelect.value, 10) || null;
    const maxUses = parseInt(maxUsesInput.value, 10) || null;

    const msg = JSON.stringify({
        type: "newInviteLink",
        eventID: crypto.randomUUID(),
        expiresInDays: expiresInDays,
        maxUses: maxUses
    });

    document.dispatchEvent(
        new CustomEvent("createNewInviteLinkLocal", { detail: msg })
    );
});


const openBtn = document.getElementById('open-invite-link-modal');
const overlay = document.getElementById('overlay');
const closeBtn = document.getElementById('close-invite-link-modal')
const inviteLinkModal = document.getElementById('invite-link-modal');

let lastFocusedElement = null;

function openModal() {
    lastFocusedElement = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; // prevent background scroll
    // move focus into the dialog
    document.addEventListener('keydown', handleKeydown);
}

function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocusedElement) lastFocusedElement.focus();
    document.removeEventListener('keydown', handleKeydown);
}

openBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);

// click overlay outside modal closes it
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
});

// ESC to close + simple Tab focus trap
function handleKeydown(e) {
    if (e.key === 'Escape') {
        closeModal();
        return;
    }
    if (e.key === 'Tab') {
        // focusable selector
        const focusables = overlay.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

const input = document.getElementById("active-invite-link");
const copyLinkBtn = document.getElementById("copy-invite-link");

function setInviteLink(msg) {
    input.value = msg.link;
}

inviteLinkModal.addEventListener('newInviteLink', (e) => {
    setInviteLink(e.detail)
})

copyLinkBtn.addEventListener('click', async () => {
    const text = input.value;

    // Preferred: Clipboard API (works on secure contexts / modern browsers)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            showCopied();
            return;
        } catch (err) {
        }
    }
});

function showCopied() {
    copyLinkBtn.classList.add('copied');
    const prev = copyLinkBtn.textContent;
    copyLinkBtn.textContent = 'Copied!';

    setTimeout(() => {
        copyLinkBtn.classList.remove('copied');
        copyLinkBtn.textContent = prev;
    }, 1400);
}
