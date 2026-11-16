// The Characters tab: a new sheet of the picked kind, my folders and sheets,
// which I rename, hide and drag, then those of the others that I may see.
import { Component, type ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { t } from "../../i18n";
import { characterList, me, roomId, sheetKinds } from "../state";
import {
    changeFolderVisibility, changeSheetVisibility, createCharacter, createFolder, deleteCharacter, deleteFolder,
    exportCharacter, moveSheetToFolder, openImportModal, renameFolder, reorderFolders,
} from "../actions";
import { isElevated } from "../permissions";
import {
    folderCollapsedKey, playerCollapsedKey, readCollapsed, readSheetKind, saveCollapsed, saveSheetKind, sheetName,
    type FolderEntry, type PlayerCharacters, type SheetEntry,
} from "../characters";
import { humanDate } from "../time_format";
import type { Visibility } from "../messages";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import { useListSortable, type Drop } from "./useListSortable";
import { leaveGmMode } from "../encounter/actions";
import { openSaveToCollection } from "../bestiary/actions";

export function Characters() {
    const [mine, ...others] = characterList.value;
    return (
        <div class="scroll-container">
            <NewCharacter />
            <button onClick={createFolder} class="button-wide button-colored create-folder-btn" type="button">
                {t("room.characters.addFolder")}
            </button>
            {mine && <MyCharacters entry={mine} />}
            {others.map(entry => <OtherCharacters key={entry.player.id} entry={entry} />)}
        </div>
    );
}

function NewCharacter() {
    const [kind, setKind] = useState(() => readSheetKind(sheetKinds.map(k => k.kind)));
    return (
        <>
            <select value={kind} class="sheet-kind-select" aria-label={t("room.characters.sheetKind")} title={t("room.characters.sheetKind")}
                onChange={e => {
                    const picked = e.currentTarget.value as SheetKind;
                    setKind(picked);
                    saveSheetKind(picked);
                }}>
                {sheetKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <div class="layout-row">
                <button onClick={() => createCharacter(kind)} class="button-wide button-large button-colored" type="button">
                    {t("room.characters.newCharacter")}
                </button>
                <button onClick={openImportModal} class="button-large button-colored import-button" type="button"
                    title={t("room.characters.import")}>
                    ↑
                </button>
            </div>
        </>
    );
}

/** Whether the player keeps a folder or a player collapsed, in localStorage under `key`. */
function useCollapsed(key: string, fallback: boolean): [boolean, () => void] {
    const [collapsed, setCollapsed] = useState(() => readCollapsed(key, fallback));
    const toggle = () => {
        saveCollapsed(key, !collapsed);
        setCollapsed(!collapsed);
    };
    return [collapsed, toggle];
}

/** A player of the list, with the header that collapses them. */
function PlayerBlock({ entry, children }: { entry: PlayerCharacters; children: ComponentChildren }) {
    const [collapsed, toggle] = useCollapsed(playerCollapsedKey(roomId, entry.player.id), false);
    return (
        <div class="player" data-user-id={entry.player.id}>
            <div class={collapsed ? "player-header collapsed" : "player-header"}>
                <div class="player-name">{entry.player.name}</div>
                <button onClick={toggle} class="player-collapse-btn" type="button" title={collapsed ? t("room.characters.expand") : t("room.characters.collapse")}></button>
            </div>
            <div class="player-collapsible-content">{children}</div>
        </div>
    );
}

const folderIdOf = (list: HTMLElement) => (list.dataset.folderId === "null" ? null : Number(list.dataset.folderId));

/** A sheet dropped into another list goes into that list's folder. */
function dropSheet({ item, from, to }: Drop): void {
    if (to !== from) moveSheetToFolder(Number(item.dataset.sheetId), folderIdOf(to));
}

function MyCharacters({ entry }: { entry: PlayerCharacters }) {
    const foldersRef = useRef<HTMLDivElement>(null);
    const looseRef = useRef<HTMLDivElement>(null);
    useListSortable(foldersRef, {
        handle: ".folder-drag-handle",
        draggable: ".folder",
        onDrop: ({ order }) => reorderFolders(order.map(el => Number(el.dataset.folderId))),
    });
    useListSortable(looseRef, { group: "sheets", handle: ".sheet-drag-handle", draggable: ".character-sheet-entry", onDrop: dropSheet });

    return (
        <PlayerBlock entry={entry}>
            <div class="folders-container sortable-folders" ref={foldersRef}>
                {entry.folders.map(folder => <MyFolder key={folder.folder.id} entry={folder} />)}
            </div>
            <div class="default-area sortable-sheets" data-player-id={entry.player.id} data-folder-id="null" ref={looseRef}>
                {entry.sheets.map(sheet => <SheetRow key={sheet.sheet.id} entry={sheet} own inFolder={false} />)}
            </div>
        </PlayerBlock>
    );
}

function MyFolder({ entry }: { entry: FolderEntry }) {
    const { folder } = entry;
    const [collapsed, toggle] = useCollapsed(folderCollapsedKey(roomId, folder.id), true);
    const sheetsRef = useRef<HTMLDivElement>(null);
    useListSortable(sheetsRef, { group: "sheets", handle: ".sheet-drag-handle", draggable: ".character-sheet-entry", onDrop: dropSheet });

    return (
        <div class="folder" data-folder-id={folder.id}>
            <div class={collapsed ? "folder-header collapsed" : "folder-header"}>
                <FolderName folderId={folder.id} name={folder.name} />
                <div class="folder-controls">
                    <button onClick={toggle} class="folder-collapse-btn" type="button" title={collapsed ? t("room.characters.expand") : t("room.characters.collapse")}></button>
                    <div class="folder-drag-handle" title={t("room.characters.dragToReorder")}></div>
                </div>
            </div>
            <div class="folder-content">
                <div class="folder-visibility">
                    <VisibilitySelect value={folder.visibility} title={t("room.characters.folderAccess")}
                        onChange={v => changeFolderVisibility(folder.id, v)} />
                    <button onClick={() => deleteFolder(folder.id)} class="folder-delete-btn" type="button" title={t("room.characters.deleteFolder")}>×</button>
                </div>
                <div class="folder-sheets sortable-sheets" data-folder-id={folder.id} ref={sheetsRef}>
                    {entry.sheets.map(sheet => <SheetRow key={sheet.sheet.id} entry={sheet} own inFolder />)}
                </div>
            </div>
        </div>
    );
}

/**
 * The name input of my folder. Its value comes from the state in an effect,
 * not a value prop, so a render never touches what the player is typing
 * (sheet/components/fields.tsx).
 */
function FolderName({ folderId, name }: { folderId: number; name: string }) {
    const input = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (input.current!.value !== name) input.current!.value = name;
    }, [name]);
    return (
        <input ref={input} type="text" class="folder-name-input" placeholder={t("room.characters.folderName")}
            onInput={e => renameFolder(folderId, e.currentTarget.value)} />
    );
}

function OtherCharacters({ entry }: { entry: PlayerCharacters }) {
    return (
        <PlayerBlock entry={entry}>
            <div class="folders-container">
                {entry.folders.map(folder => <OtherFolder key={folder.folder.id} entry={folder} />)}
            </div>
            <div class="default-area" data-player-id={entry.player.id}>
                {entry.sheets.map(sheet => <SheetRow key={sheet.sheet.id} entry={sheet} own={false} inFolder={false} />)}
            </div>
        </PlayerBlock>
    );
}

function OtherFolder({ entry }: { entry: FolderEntry }) {
    const { folder } = entry;
    const [collapsed, toggle] = useCollapsed(folderCollapsedKey(roomId, folder.id), true);
    return (
        <div class="folder" data-folder-id={folder.id}>
            <div class={collapsed ? "folder-header collapsed" : "folder-header"}>
                <span class="folder-name-display">{folder.name}</span>
                <div class="folder-controls">
                    <button onClick={toggle} class="folder-collapse-btn" type="button" title={collapsed ? t("room.characters.expand") : t("room.characters.collapse")}></button>
                </div>
            </div>
            <div class="folder-content">
                {entry.sheets.map(sheet => <SheetRow key={sheet.sheet.id} entry={sheet} own={false} inFolder />)}
            </div>
        </div>
    );
}

type SheetRowProps = { entry: SheetEntry; own: boolean; inFolder: boolean };

/**
 * A sheet of the list. The list builds new entries on every change, as each
 * key typed in a sheet's name: a row renders again only when its own sheet
 * changes. Not memo of preact/compat: compat turns onChange of every input
 * of the page into onInput.
 */
class SheetRow extends Component<SheetRowProps> {
    shouldComponentUpdate(next: SheetRowProps): boolean {
        const { entry, own, inFolder } = this.props;
        return entry.sheet !== next.entry.sheet || entry.canOpen !== next.entry.canOpen || own !== next.own || inFolder !== next.inFolder;
    }

    render(props: SheetRowProps) {
        return <SheetRowContent {...props} />;
    }
}

/** Mine drag, and outside folders pick their visibility. */
function SheetRowContent({ entry, own, inFolder }: SheetRowProps) {
    const { sheet } = entry;
    const name = sheetName(sheet);
    const created = useMemo(() => humanDate(sheet.createdAt), [sheet.createdAt]);
    const updated = useMemo(() => humanDate(sheet.updatedAt), [sheet.updatedAt]);
    const kind = sheetKinds.find(k => k.kind === sheet.kind)?.label ?? sheet.kind;
    return (
        <div class="character-sheet-entry" data-sheet-id={sheet.id}>
            <div class="sheet-content">
                <div class="name">
                    {/* The sheet bundle opens the link in the room's container, which GM mode hides. */}
                    {entry.canOpen ? <a href={`/sheet/view/${sheet.id}`} onClick={leaveGmMode}>{name}</a> : <span>{name}</span>}
                    {own && <div class="sheet-drag-handle" title={t("room.characters.dragToMove")}></div>}
                </div>
                <div class="meta system">{kind}</div>
                <div class="meta updated" title={t("room.characters.createdModified", { created, modified: updated })}>{t("room.characters.modified", { date: updated })}</div>
                <div class="entry-controls">
                    <div class="control-buttons">
                        {own && !inFolder && (
                            <VisibilitySelect value={sheet.visibility} title={t("room.characters.access")} onChange={v => changeSheetVisibility(sheet.id, v)} />
                        )}
                    </div>
                    <div class="control-buttons">
                        <button onClick={() => exportCharacter(sheet.id)} class="export-entry" type="button" title={t("room.characters.export")}></button>
                        {/* Whoever may open the sheet may export it, and so keep it in their bestiary. */}
                        {entry.canOpen && (
                            <button onClick={() => openSaveToCollection(sheet.id, name)} class="save-to-collection-entry" type="button"
                                title={t("room.modals.saveToCollection.title")}></button>
                        )}
                        {(own || isElevated(me.value.role)) && (
                            <button onClick={() => deleteCharacter(sheet.id)} class="delete-entry" type="button" title={t("room.characters.delete")}></button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function VisibilitySelect({ value, title, onChange }: { value: Visibility; title: string; onChange: (v: Visibility) => void }) {
    const visibilities: [Visibility, string][] = [
        ["everyone_can_edit", t("room.characters.visibility.everyoneCanEdit")],
        ["everyone_can_view", t("room.characters.visibility.everyoneCanView")],
        ["everyone_can_see", t("room.characters.visibility.everyoneCanSee")],
        ["hide_from_players", t("room.characters.visibility.hideFromPlayers")],
    ];
    return (
        <select value={value} title={title} onChange={e => onChange(e.currentTarget.value as Visibility)}>
            {visibilities.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
    );
}
