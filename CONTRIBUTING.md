# Contributing to Tumult

Welcome! We rely on a disciplined and stable workflow to maintain the architecture and ensure reliable releases. This document outlines our standards for coding, testing, and releasing.

## 🤝 Software Development Lifecycle (SDLC)

We adhere to a strict, fully automated release cycle. All new features and fixes must go through the following path:

1.  **Feature Branch:** Create a branch (e.g., `feat/new-feature`).
2.  **Development:** Implement changes and ensure comprehensive tests pass locally.
3.  **Commit:** Commit using **Conventional Commits**.
4.  **Merge Request:** Open a Pull Request targeting `main`.
5.  **CI/CD:** The GitHub Actions workflow will automatically run Unit Tests, Integration Tests, and the Build Phase. *The PR cannot be approved/merged until 100% of the CI passes.*
6.  **Release:** Once code is merged to `main`, the tooling will be ready for the final release.

## 🏷️ Conventional Commits (Enforcing Semantic Versioning)

All commits must follow the [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/). This is how we tell the `standard-version` tool how to bump the version automatically.

| Type | Meaning | Version Bump | Example |
| :--- | :--- | :--- | :--- |
| `feat` | A new feature for the user. | **MINOR** | `feat: adds new command for dice roll` |
| `fix` | A bug fix in the existing functionality. | **PATCH** | `fix: corrects off-by-one error in timeline limit` |
| `docs` | Documentation-only changes. | **NONE** | `docs: updates docs/themes.md` |
| `style` | Code style changes. | **NONE** | `style: formats code to adhere to Prettier rules` |
| `refactor` | A code change that neither fixes a bug nor adds a feature. | **NONE** | `refactor: simplifies contract.ts interface` |
| `chore` | Maintenance tasks (e.g., dependency updates, build system changes). | **NONE** | `chore: updates pnpm version in package.json` |
| `BREAKING CHANGE` | A change that requires users to modify their code or configuration. | **MAJOR** | `feat!: removes deprecated API endpoint` |

**🔑 Important:** The `BREAKING CHANGE` must be included in the commit body following a `feat` or `fix` type.

## 🚀 The Release Process (Finalizing the Release)

Once your work is merged into `main` and the CI passes:

1.  **Manual Trigger:** A maintainer runs the release command from the root directory:
    ```bash
    pnpm release
    ```
    This runs `standard-version --no-verify` — the `--no-verify` skips a local git
    hook so the release commit can't wedge the run.
2.  **Automation:** `standard-version` then:
    *   Checks commit history to determine the version change (e.g., Minor for `feat`).
    *   Updates the root `package.json` version and writes `CHANGELOG.md`.
    *   Creates a `v…` tag and commits `chore(release): …` to `main`.

    > ⚠️ **Run `release` once per release.** It is *not* idempotent: re-running it
    > creates a second, empty tag. To fix or improve a release, add a commit and
    > cut a *new* tag — never re-run `release` to repair the old one. (A stray
    > duplicate `v0.1.0` tag appeared during setup and was removed; `v0.1.1` is the
    > canonical tag.)
3.  **Deployment:** The new tag push triggers `.github/workflows/release.yml`,
    which runs Vercel's official GitHub Actions pattern — **pull → build →
    deploy `--prebuilt`** via the Vercel CLI (no third-party action). The build
    runs in the Actions runner and only `.vercel/output` is uploaded, so Vercel
    never rebuilds the same artifact. Build-time env like `VITE_CLIENT_URI`
    comes from the Vercel project's environment via `vercel pull`, so nothing
    is plumbed through CI secrets. The workflow needs three secrets in *repo →
    Settings → Secrets*: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
    (the two IDs together let the CLI skip `vercel link`). Your Vercel project
    must point at the Vite app in `apps/web/` (framework: Vite, build:
    `pnpm build`, output: the Vite out dir). CI on `main` is the gate that
    `release.yml` trusts. `release.yml` is also `workflow_dispatch`-able:
    because `pnpm release` tags are not re-runnable, run it manually against
    `main` to dry-run the pipeline without cutting a release.

    > ⚠️ **Every `vercel` step runs from the repo root**, because the Vercel
    > project's **Root Directory is already `apps/web`** (set in the dashboard,
    > and the canonical source of that prefix). The CLI applies that root
    > itself, so a step whose working directory is also `apps/web` composes the
    > two into `apps/web/apps/web` — `vercel build` tolerates that with a
    > warning, but `vercel deploy` fails outright with *"The provided path …
    > does not exist"*. Only one side may carry the prefix.
    >
    > The consequence to know: `vercel pull` writes
    > `.vercel/.env.production.local` *relative to the working directory*, so it
    > lands at the **repo root**, and `apps/web/vite.config.ts` therefore sets
    > `envDir` to the repo root. If `envDir` is wrong, the build silently loses
    > `VITE_CLIENT_URI` — which is what took the production site down with a
    > blank page. Vite's `envDir` covers local `.env.local` too, so dev and the
    > deployed build read env from the same place (`.env.example` sits at the
    > repo root alongside them).

    > ⚠️ **`VITE_CLIENT_URI` is required to build the real client.** It cannot be
    > derived from `window.location`, because MAS rejects http and rejects
    > `localhost` under either scheme, and it identifies the *application* (it is
    > shown on the consent screen and never fetched). `apps/web/vite.config.ts`
    > fails the build when it is missing, so a wrong setup breaks CI loudly
    > instead of shipping an app that throws during import and renders nothing.
    > CI's own `pnpm -r build` gate therefore supplies a placeholder
    > (`https://ci.invalid`); the production value lives in the Vercel project.
    > Copy `.env.example` to `.env.local` at the repo root for local dev.

## 🧪 What CI runs on every change

`.github/workflows/ci.yml` (runs on push / PR to `main`):

1.  **Type Checking:** `pnpm -r typecheck` catches contract drift across all packages.
2.  **Unit Tests:** `pnpm -r test` — the hermetic per-package `test/` suites (core, ui, theme).
3.  **Browser Smoke Test:** `pnpm --filter @tumult/web test:browser` — a `--mode fake` build with **no homeserver and no network** (see the test docstring), so it is safe in plain CI.
4.  **Build:** `pnpm -r build` compiles every package **including the real client** (so it needs a `VITE_CLIENT_URI`; CI passes a placeholder); this is the gate `release.yml` trusts.

**Local-only, not in CI:** the Docker/Synapse integration suite (`pnpm test:integration`
→ `tests/synapse/run.sh`) and the live-homeserver test
(`pnpm --filter @tumult/web test:live`) need Docker / a real server, so they are
kept out of the default pipeline to keep `main` green without a Docker-in-Docker runner.

If `main` is green, the release step (tagging + Vercel deploy) is safe to run.

## 🛑 Deliberately Not Supported

*As defined in `AGENTS.md` and `docs/plugins.md`:*
*   No remote or user-supplied plugins/themes.
*   No shell/pane replacement.
*   This repository is strictly for core development and release management.
