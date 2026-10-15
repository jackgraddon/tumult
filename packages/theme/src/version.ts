/**
 * Version of the token contract (`ThemeJson.version`).
 *
 * v1: color/spacing/radius/typography/motion/layout only.
 * v2: adds size/shadow/z-index/line-height/letter-spacing/font-weight/
 *     border-width/opacity kinds, state tokens, mode overrides. v1 themes stay
 *     valid (see `docs/themes.md` §9).
 */
export const TOKEN_CONTRACT_VERSION = 2;

/** Contract versions this build still accepts. */
export const SUPPORTED_TOKEN_CONTRACT_VERSIONS: readonly number[] = [1, 2];
