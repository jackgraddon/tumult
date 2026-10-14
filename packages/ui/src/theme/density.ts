/**
 * Density → virtualizer estimates.
 *
 * The virtualizer needs a *number* for every row it has never rendered, before
 * any measurement exists, and a token (`var(--timeline-row-padding-y)`) is not a
 * number. So the row-height effect of density is mirrored here in pixels for
 * the built-in densities.
 *
 * It is a mirror, not the source of truth: the CSS (a theme's `densities` map)
 * is what actually moves the rows. Rendered rows are measured, so a wrong
 * estimate only mis-sizes the scroll extent of rows that have never been on
 * screen, and it is replaced the moment the row renders. A theme with its own
 * density names therefore keeps the base figures — off, but self-correcting.
 *
 * Mirrored from `packages/theme/themes/default.json`:
 *   cozy     row padding-y = space-1   (4px)
 *   compact  row padding-y = space-0-5 (2px)
 *   spacious row padding-y = space-2   (8px)
 * A row's height moves by twice its vertical padding (top + bottom).
 */
const ROW_PADDING_Y_PX: Record<string, number> = {
    cozy: 4,
    compact: 2,
    spacious: 8,
};

const BASE_PADDING_Y_PX = ROW_PADDING_Y_PX["cozy"] ?? 4;

/**
 * Pixels to add to a row's base (cozy) height estimate at this density.
 * Zero for `cozy` and for any density name this build does not know.
 */
export function densityRowDelta(density: string | undefined): number {
    const padding = density === undefined ? BASE_PADDING_Y_PX : (ROW_PADDING_Y_PX[density] ?? BASE_PADDING_Y_PX);
    return (padding - BASE_PADDING_Y_PX) * 2;
}
