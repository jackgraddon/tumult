/**
 * Token contract, default theme, and theme validator.
 *
 * Lands in slice 2 ("3-pane shell with fake data + default theme"). The shape
 * it has to end up with, per the project spec:
 *
 *   primitives (raw palette)
 *     -> semantic (surface / text / accent / border / danger)
 *       -> per-component
 *
 * Components may only reference semantic and per-component tokens, never
 * primitives. Coverage is not just colour: spacing, radius, typography, motion
 * and layout dimensions (`--layout-guild-rail-width`, `--layout-members-width`)
 * are all part of the contract, and the token list is versioned.
 *
 * JSON is the default authoring path — validate, then emit CSS custom
 * properties onto `:root[data-theme="name"]`. Raw CSS stays an explicit
 * advanced opt-in so the CSP can stay strict.
 */

export const TOKEN_CONTRACT_VERSION = 0;
