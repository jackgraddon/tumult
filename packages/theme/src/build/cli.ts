/**
 * Build entry — the only module in `build/` with side effects.
 *
 *   pnpm --filter @tumult/theme build
 *
 * compiles `themes/*.json` → `dist/themes/*.css` and regenerates the authored
 * docs (`docs/tokens.md`, `docs/theme.schema.json`) so what GitHub renders and
 * what the app ships are built from the same source. `test/docs.test.ts` fails
 * if the committed docs drift from this output.
 */
import { compileThemes } from "./compile.ts";
import { emitDocs } from "./emit-docs.ts";

compileThemes();
emitDocs();
