# Design principles

Tokens are in `themes/themes.css`.

## Backgrounds
- Page under the panels: `bg-light` (near black or white).
- Panel, sheet: `bg`.
- Item on a panel: `bg-item`; nested: `bg-item2`, `bg-item3`. Each level is lighter in the dark theme, darker in the light one.
- Menus and popovers: one level above what they cover.
- Inputs: `bg-input` at any level.

## Hover and selection
- Hover: `button-bg-subtle-hover`; on a `bg-item` row, the next level.
- Selected: a 1px `accent` frame and the name in bold `accent`, never a background level.
- A current state (whose turn it is): filled with `button-bg`.

## Buttons by role
- Primary: filled with `button-bg`, one per area. A symbol where the app already uses one (↑ upload).
- Secondary: `button-bg-subtle`, `border-medium`.
- Delete: looks secondary, red (`accent-attention`) on hover, asks to confirm. Red text inside a ⋯ menu.
- Icons (✎ ⋯ ×): no border, `text-secondary`, faint until hovered.
- Toggles: secondary, filled with `button-bg` when on.

## Editing
- Rename in place: ✎ after the name; the field keeps the line's height; Enter or leaving saves, Esc cancels.
- A single text field is edited in place and saved on leaving it, not in a modal.
- A preview opens the full view by its button, not by a click on it.
- `main.css` and `common.css` restyle tables, textareas, text inputs and buttons on every page: override them where needed.
