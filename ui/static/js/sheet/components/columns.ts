import type { Position } from "../schema/content.gen";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Item ids of a grid by column, as columnsFromLayout in sheet_funcs.go
 * renders them. Positioned items go to their column (clamped to the grid)
 * sorted by row, then id. Positions without an item are skipped. Items
 * without a position are sorted by id and dealt row by row into the columns
 * that are that short.
 */
export function columnsFromLayout(
    colsCount: number,
    positions: { readonly [id: string]: Position } | null | undefined,
    itemIds: Iterable<string>,
): string[][] {
    const count = Math.max(1, Math.floor(colsCount) || 1);
    const cols: string[][] = Array.from({ length: count }, () => []);
    const items = new Set(itemIds);
    if (items.size === 0) return cols;

    const placed = new Set<string>();
    const byColumn: { row: number; id: string }[][] = Array.from({ length: count }, () => []);
    for (const [id, pos] of Object.entries(positions ?? {})) {
        if (!items.has(id)) continue;
        const col = Math.min(Math.max(pos.colIndex, 0), count - 1);
        byColumn[col].push({ row: pos.rowIndex, id });
    }
    byColumn.forEach((entries, c) => {
        entries.sort((a, b) => a.row - b.row || byId(a.id, b.id));
        for (const e of entries) {
            cols[c].push(e.id);
            placed.add(e.id);
        }
    });

    const missing = [...items].filter(id => !placed.has(id)).sort(byId);
    let next = 0;
    for (let row = 0; next < missing.length; row++) {
        for (let c = 0; c < count && next < missing.length; c++) {
            if (cols[c].length === row) cols[c].push(missing[next++]);
        }
    }
    return cols;
}
