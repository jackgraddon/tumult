/**
 * How many columns and rows make `count` equal tiles as large as possible inside
 * a `width` x `height` box. The stage never scrolls: it picks the grid that fits,
 * so adding a participant shrinks everyone instead of overflowing.
 *
 * "Large" is the biggest 16:9 rectangle that fits in a cell, because that is
 * what a camera or a shared screen mostly is. Ties go to the grid with fewer
 * columns, which reads top-to-bottom the way a list does.
 */
export function bestGrid(count: number, width: number, height: number, gap: number, aspect = 16 / 9): { cols: number; rows: number } {
    if (count <= 1) return { cols: 1, rows: 1 };
    // Before the first measurement there is nothing to optimise against.
    if (!(width > 0) || !(height > 0)) {
        const cols = Math.ceil(Math.sqrt(count));
        return { cols, rows: Math.ceil(count / cols) };
    }
    let best = { cols: 1, rows: count };
    let bestArea = -1;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const cellW = (width - gap * (cols - 1)) / cols;
        const cellH = (height - gap * (rows - 1)) / rows;
        if (cellW <= 0 || cellH <= 0) continue;
        const w = Math.min(cellW, cellH * aspect);
        const area = w * (w / aspect);
        // A strictly larger area wins; an equal one keeps the earlier (fewer columns).
        if (area > bestArea + 1e-6) {
            bestArea = area;
            best = { cols, rows };
        }
    }
    return best;
}

export interface StageTile {
    key: string;
    source: "camera" | "screen";
}

/**
 * Which tiles are in the spotlight. A tile the user has clicked follows that
 * choice; any other tile follows the default, which is that a shared screen is
 * spotlit (it is the thing being looked at) and a camera is not.
 */
export function isSpotlit(tile: StageTile, overrides: Readonly<Record<string, boolean>>): boolean {
    return overrides[tile.key] ?? tile.source === "screen";
}

/**
 * Split the tiles into the spotlight and the strip beside it. With nothing
 * spotlit there is no strip: everyone is in one even grid. With everything
 * spotlit there is no strip either.
 */
export function partition<T extends StageTile>(tiles: readonly T[], overrides: Readonly<Record<string, boolean>>): { main: T[]; strip: T[] } {
    const spot = tiles.filter((tile) => isSpotlit(tile, overrides));
    if (spot.length === 0) return { main: [...tiles], strip: [] };
    return { main: spot, strip: tiles.filter((tile) => !isSpotlit(tile, overrides)) };
}

/** Drop choices for tiles that no longer exist, so a re-shared screen starts at its default. */
export function pruneOverrides(overrides: Readonly<Record<string, boolean>>, keys: readonly string[]): Record<string, boolean> {
    const live = new Set(keys);
    return Object.fromEntries(Object.entries(overrides).filter(([key]) => live.has(key)));
}
