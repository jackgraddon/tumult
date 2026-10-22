/**
 * The icons Tumult's own chrome draws, by Material Design Icons name.
 *
 * This list is the single input to `scripts/emit-icons.ts`, which copies just
 * these paths out of `@mdi/js` into `builtin.generated.ts` so first-party icons
 * render synchronously from the main bundle. `@mdi/js` itself is only ever
 * `import()`ed (see `mdi.ts`), so the rest of the library stays a lazy chunk.
 * Add a name here, run `pnpm --filter @tumult/ui emit:icons`, commit the result.
 */
export const BUILTIN_ICON_NAMES = [
    "alert",
    "account-group",
    "chevron-left",
    "chevron-right",
    "close",
    "cog",
    "crown",
    "delete",
    "dots-horizontal",
    "emoticon-plus-outline",
    "forum",
    "magnify",
    "menu",
    "message-text",
    "paperclip",
    "pencil",
    "plus",
    "poll",
    "puzzle",
    "reply",
    "shield-check",
    "thumb-up",
] as const;

export type BuiltinIconName = (typeof BUILTIN_ICON_NAMES)[number];
