# Contributing to Tumult

Welcome! We rely on a disciplined and stable workflow to maintain the architecture and ensure reliable releases. This document outlines our standards for coding, testing, and releasing.

## 🤝 Software Development Lifecycle (SDLC)

We use a disciplined workflow: CI gates every change on `main`, and a maintainer
cuts releases. All new features and fixes must go through the following path:

1.  **Feature Branch:** Create a branch (e.g., `feat/new-feature`).
2.  **Development:** Implement changes and ensure comprehensive tests pass locally.
3.  **Commit:** Commit using **Conventional Commits**.
4.  **Merge Request:** Open a Pull Request targeting `main`.
5.  **CI/CD:** `.github/workflows/ci.yml` gates the change with type checking,
    lint, hermetic unit tests (with coverage), the fake-mode browser smoke test
    and a full build. Integration suites run separately (see below). *The PR
    cannot be approved/merged until 100% of the CI passes.*
6.  **Release:** CI on `main` is the quality gate; cutting the release is a
    manual step (see below).

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

Once your work is merged into `main` and the CI passes, a maintainer cuts the
release manually:

1.  **Manual Trigger:** A maintainer runs the release command from the root directory:
    ```bash
    pnpm release          # conventional-commit bump (patch/minor/major)
    pnpm release v0.2.0   # skip the bump; use this version
    ```
    Both paths run `standard-version --no-verify` — the `--no-verify` skips a
    local git hook so the release commit can't wedge the run. With a version
    argument the bump is skipped: the tag must not already exist and must be
    newer than the latest `v*` tag, otherwise the script exits with a reason
    and does not cut a release.
2.  **Automation:** `standard-version` then:
    *   Without a version, checks commit history to determine the bump (e.g. Minor for `feat`). With `pnpm release v0.2.0`, uses that number via `--release-as`.
    *   Updates the root `package.json` version and writes `CHANGELOG.md`.
    *   Creates a `v…` tag and commits `chore(release): …` to `main`.
    *   Pushes the commit and tag to `origin`, then cuts a **draft** GitHub
        release for the tag with that version's CHANGELOG section as notes.

    > ⚠️ **Run `release` once per release.** It is *not* idempotent: re-running it
    > creates a second, empty tag. To fix or improve a release, add a commit and
    > cut a *new* tag — never re-run `release` to repair the old one. (A stray
    > duplicate `v0.1.0` tag appeared during setup and was removed; `v0.1.1` is the
    > canonical tag.)
3.  **Web deployment:** The new tag push triggers two workflows. The Vercel one,
    `.github/workflows/release.yml`, runs Vercel's official GitHub Actions pattern
    — **pull → build → deploy `--prebuilt`** via the Vercel CLI (no third-party
    action). The build runs in the Actions runner and only `.vercel/output` is
    uploaded, so Vercel never rebuilds the same artifact. Build-time env like
    `VITE_CLIENT_URI` comes from the Vercel project's environment, pulled at
    build time via `vercel pull`, so nothing is plumbed through CI secrets. The
    workflow needs three secrets in *repo → Settings → Secrets*: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
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

4.  **Desktop packages and publish gate:** the other tag-triggered workflow,
    `.github/workflows/desktop.yml`, runs desktop unit and smoke tests, packages
    AppImage/deb/rpm (Linux) and NSIS (Windows), and attaches the packages plus
    `latest*.yml` update metadata as raw assets to the draft release. It never
    publishes the release: publishing the draft is the explicit gate that makes
    desktop updates visible. On manual dispatch and on branches touching
    `apps/desktop/**` (or the workflow itself), it uploads artifacts instead.

## 🧪 What CI runs on every change

`.github/workflows/ci.yml` (runs on push / PR to `main`, plus manual
`workflow_dispatch`):

1.  **Install:** `pnpm install --frozen-lockfile` with the pinned pnpm/Node.
2.  **Type Checking:** `pnpm -r typecheck` catches contract drift across all packages.
3.  **Lint:** `pnpm lint` (one root ESLint flat config, correctness rules only).
4.  **Unit Tests:** `pnpm -r test:coverage` — the hermetic per-package `test/`
    suites (core, ui, theme). Integration suites are intentionally excluded. The
    coverage summary goes to the job summary and `lcov.info` is uploaded as an
    artifact (reported, not gated).
5.  **Browser Smoke Test:** Firefox is installed, then
    `pnpm --filter @tumult/web test:browser` — a `--mode fake` build with **no
    homeserver and no network** (see the test docstring), so it is safe in plain CI.
6.  **Build:** `pnpm -r build` compiles every package **including the real client**
    (so it needs a `VITE_CLIENT_URI`; CI passes `https://ci.invalid`); this is the
    gate `release.yml` trusts.

**Integration suites, separate from the gate:** the Synapse suite
(`pnpm test:integration` → `tests/synapse/run.sh`) and the MatrixRTC stack
(`pnpm test:rtc` → `tests/rtc/run.sh`) run against a real homeserver, so they live
in `.github/workflows/integration.yml` and never block `main`. That workflow runs
nightly, on `workflow_dispatch` with a `suite` choice (`synapse`, `rtc`, `all`;
default `synapse`), and on PRs touching `packages/core/**`, `tests/**`,
`packages/ui/src/calls/**`, `apps/web/vite.config.ts`,
`apps/web/src/chat.real.ts`, `apps/web/test/rtc-media.test.ts`, `pnpm-lock.yaml`
or the workflow itself. Nightly and matching PRs run both stacks; a manual run
runs the chosen one. In particular, a plain
`gh workflow run integration.yml --ref <branch>` runs only Synapse; add
`-f suite=rtc` for RTC or `-f suite=all` for both.

The RTC stack runs the core `call`/`voice` integration tests, then four browser
suites when `RTC_MEDIA=1` (the default; `RTC_MEDIA=0` skips all four):
`rtc-media.test.ts` (two Chromiums join one encrypted video call through the
built app and must hear each other's tone and see each other's colour),
`e2ee.test.ts` (one account on three devices: recovery setup, emoji verification
and history restored from the recovery key), `network.test.ts` (a device loses
the network mid-session: the app must report it, recover, catch up and deliver
what was sent offline) and `element-call.test.ts` (the embedded Element Call
path). Its stack uses host networking (Linux; Docker Desktop needs host
networking enabled).

Locally they need **Docker or Podman** (`tests/container.sh` picks whichever
works; force one with `CONTAINER_RUNTIME=podman`). With neither, run them on
GitHub's runners instead:

```bash
gh workflow run integration.yml --ref "$(git branch --show-current)"  # Synapse
gh workflow run integration.yml --ref "$(git branch --show-current)" -f suite=rtc
gh workflow run integration.yml --ref "$(git branch --show-current)" -f suite=all
gh run watch
```

…or point the suite at a Synapse you already run, with no container at all:
`TEST_SYNAPSE_URL=http://host:8008 pnpm test:integration`. Under rootless Podman
the generated `tests/*/data/` belongs to the container's user; reset it with
`podman unshare rm -rf tests/synapse/data`.

The live-homeserver test (`pnpm --filter @tumult/web test:live`) needs a logged-in
real server, so it stays manual.

If `main` is green, the manual release step is safe to run: the tag triggers the
Vercel deploy and desktop packaging.

## 🛑 Deliberately Not Supported

*As defined in `AGENTS.md` and `docs/plugins.md`: these are deliberate limits,
not missing features. Remote plugins and themes are supported: plugins install
from GitHub releases; themes from the gallery, pasted JSON or a file.*

*   No shell/pane replacement — plugins may contribute panes, not replace the shell.
*   This repository is strictly for core development and release management.
