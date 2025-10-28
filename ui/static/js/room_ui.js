// charactersheet entry

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
    sheetControls.className = "entry-controls";
    const button = document.createElement("button");
    button.className = "delete-entry";
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

    if (!btn.classList.contains('delete-entry') && btn.dataset.action !== 'delete') return;

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

// change name
function changeName(msg) {
    const name = document.querySelector(`.character-sheet-entry[data-sheet-id="${msg.sheetID}"] .name a`);
    name.textContent = msg.change;
}

characters.addEventListener('nameChanged', (e) => {
    changeName(e.detail)
});

// invite link
const newInviteLink = document.getElementById("create-new-invite-link")
newInviteLink?.addEventListener("click", function () {
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

// modal
const openInviteModalBtn = document.getElementById('open-invite-link-modal');
const overlay = document.getElementById('overlay');
const closeInviteModalBtn = document.getElementById('close-invite-link-modal');
const closeKickedModalBtn = document.getElementById('close-kicked-modal');
const inviteLinkModal = document.getElementById('invite-link-modal');
const kickedModal = document.getElementById('kicked-modal');

let lastFocusedElement = null;
let currentModal = null;

function openModal(modalElement) {
    // Hide all modals first
    if (inviteLinkModal) inviteLinkModal.style.display = 'none';
    if (kickedModal) kickedModal.style.display = 'none';

    // Show the requested modal
    modalElement.style.display = 'flex';
    currentModal = modalElement;

    lastFocusedElement = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeydown);

    // Focus first focusable element in the modal
    const focusables = modalElement.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length) focusables[0].focus();
}

function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocusedElement) lastFocusedElement.focus();
    document.removeEventListener('keydown', handleKeydown);
    currentModal = null;
}

function closeKickedModalAndRedirect() {
    closeModal();
    const origin = window.location.origin;
    window.location.href = `${origin}/account/rooms`;
}

openInviteModalBtn?.addEventListener('click', () => openModal(inviteLinkModal));
closeInviteModalBtn?.addEventListener('click', closeModal);
closeKickedModalBtn.addEventListener('click', closeKickedModalAndRedirect);

// Click overlay outside modal closes it
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        // If kicked modal is open, redirect on overlay click too
        if (currentModal === kickedModal) {
            closeKickedModalAndRedirect();
        } else {
            closeModal();
        }
    }
});

// ESC to close + Tab focus trap
function handleKeydown(e) {
    if (e.key === 'Escape') {
        // If kicked modal is open, redirect on ESC too
        if (currentModal === kickedModal) {
            closeKickedModalAndRedirect();
        } else {
            closeModal();
        }
        return;
    }
    if (e.key === 'Tab' && currentModal) {
        const focusables = currentModal.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
function showKickedModal() {
    openModal(kickedModal);
}

// invite link
const input = document.getElementById("active-invite-link");
const copyLinkBtn = document.getElementById("copy-invite-link");

function setInviteLink(msg) {
    input.value = msg.link;
}

inviteLinkModal?.addEventListener('newInviteLink', (e) => {
    setInviteLink(e.detail)
})

copyLinkBtn?.addEventListener('click', async () => {
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


// kick player
const players = document.getElementById('players')

players.addEventListener('kickPlayer', (e) => {
    deletePlayerEntry(e.detail);
});

function deletePlayerEntry(msg) {
    const entry = document.getElementById("current-player")
    const currentUserID = parseInt(entry.dataset.userId, 10);
    if (msg.userID == currentUserID) {
        showKickedModal()
    }
    const els = document.querySelectorAll(`.player[data-user-id="${msg.userID}"]`);
    els.forEach(el => {
        el.remove();
    });
}

players.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !players.contains(btn)) return;

    if (!btn.classList.contains('delete-entry') && btn.dataset.action !== 'delete') return;

    const entry = btn.closest('.player');
    if (!entry) return;

    const userId = parseInt(entry.dataset.userId)

    if (!userId) {
        console.warn('No player id found for delete button', entry);
        return;
    }

    const nameEl = entry.querySelector('.player-name');
    const userName = nameEl ? nameEl.textContent.trim() : '(unnamed)';
    if (!confirm(`Kick ${userName}?`)) return;

    // prevent double sends
    if (btn.disabled || btn.classList.contains('deleting')) return;
    btn.disabled = true;
    btn.classList.add('deleting');

    const payload = {
        type: 'kickPlayer',
        eventID: crypto.randomUUID(),
        userID: userId
    };
    deletePlayerEntry(payload)
    const data = JSON.stringify(payload);

    players.dispatchEvent(new CustomEvent('kickPlayerLocal', {
        detail: data
    }));

    setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('deleting');
    }, 5_000);
});

// change player role
players.addEventListener('changePlayerRole', (e) => {
    changePlayerRole(e.detail);
});

function changePlayerRole(msg) {
    if (typeof msg === 'string') msg = JSON.parse(msg);

    const container = document.getElementById("players");
    const entry = container.querySelector(`.player[data-user-id="${msg.userID}"]`);
    if (!entry) return;

    const select = entry.querySelector('.role-select');
    // If there's a select visible for role, update its value.
    if (select) {
        if (select.value !== msg.role) select.value = msg.role;
    } else {
        // otherwise update the static role text (if role shown as plain text)
        const roleText = entry.querySelector('.meta.role');
        if (roleText) roleText.textContent = msg.role;
    }
}

players.addEventListener('change', (e) => {
    if (!e.target.matches('.role-select')) return;

    const select = e.target;
    const entry = select.closest('.player');
    if (!entry) return;

    const userId = parseInt(entry.dataset.userId, 10);
    if (!userId) {
        console.warn('No player id found for role select', entry);
        return;
    }

    const newRole = select.value;

    if (select.disabled || select.classList.contains('updating')) return;
    select.disabled = true;
    select.classList.add('updating');

    const payload = {
        type: 'changePlayerRole',
        eventID: crypto.randomUUID(),
        userID: userId,
        role: newRole
    };
    const data = JSON.stringify(payload);

    players.dispatchEvent(new CustomEvent('changePlayerRoleLocal', { detail: data }));

    setTimeout(() => {
        select.disabled = false;
        select.classList.remove('updating');
    }, 300);
});