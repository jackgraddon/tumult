// One flat config for the whole workspace, run from the root (`pnpm lint`).
//
// Correctness rules only: formatting is not linted, and typing is tsc's job
// (`pnpm -r typecheck`). Rules that need type information are left off, so a
// lint run never has to build the project graph.
import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/dist-types/**",
            "**/*.generated.ts",
            // Generated from packages/ui (see its header); lint the source instead.
            "templates/plugin/types/**",
            // Agent worktrees are other checkouts of this repo.
            ".claude/**",
            "tests/synapse/data/**",
            "tests/rtc/data/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...vue.configs["flat/essential"],
    {
        files: ["**/*.vue"],
        languageOptions: { parserOptions: { parser: tseslint.parser } },
    },
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            // The codebase's defensive idiom initialises a value, then resets it
            // in `catch` so every branch states its fallback; that is intended.
            "no-useless-assignment": "off",
            // `Icon` and `Avatar` are primitives; one-word names are the point.
            "vue/multi-word-component-names": "off",
            // `_`-prefixed names are the deliberate "unused on purpose" spelling.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
            ],
        },
    },
    {
        // Tests stub the SDK with partial shapes; `any` there is a cast, not a type.
        files: ["**/test/**", "**/test-integration/**"],
        rules: { "@typescript-eslint/no-explicit-any": "off" },
    },
);
