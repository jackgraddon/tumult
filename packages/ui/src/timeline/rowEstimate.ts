import { densityRowDelta } from "../theme/density.ts";

/**
 * Pre-measurement row heights for the virtualizer, in pixels.
 *
 * These are estimates only: every rendered row is measured by the virtualizer
 * from the real DOM. They matter for rows that have never been on screen — the
 * total scroll extent, a jump to a search hit, and history prepends all use
 * them before measurement replaces them.
 *
 * The bases are measured from the built-in theme's cozy density: one-line
 * message row with header (~44px), a grouped continuation (~19px), the day
 * divider (~30px) and the unread divider (~22px). Density only moves the
 * message row's own vertical padding; the dividers use the fixed space tokens.
 */
export interface TimelineRowEstimateInput {
    grouped: boolean;
    dayLabel: string | null;
    unreadBefore: boolean;
}

const UNGROUPED_ROW_PX = 44;
const GROUPED_ROW_PX = 19;
const DAY_DIVIDER_PX = 30;
const UNREAD_DIVIDER_PX = 22;

export function estimateTimelineRowHeight(
    row: TimelineRowEstimateInput,
    density: string | undefined,
): number {
    // A grouped row has padding-top/bottom 0 by design, so density cannot move it.
    const message = row.grouped ? GROUPED_ROW_PX : UNGROUPED_ROW_PX + densityRowDelta(density);
    return (
        message +
        (row.dayLabel === null ? 0 : DAY_DIVIDER_PX) +
        (row.unreadBefore ? UNREAD_DIVIDER_PX : 0)
    );
}
