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

1.  **Manual Trigger:** You (or a designated maintainer) must manually run the release command from the root directory:
    ```bash
    pnpm release
    ```
2.  **Automation:** This executes `standard-version`, which will:
    *   Check commit history to determine the version change (e.g., Minor for `feat`).
    *   Update `package.json` with the new version.
    *   Create a Git tag (e.g., `v1.1.0`).
    *   Commit the changes to `main`.
3.  **Deployment:** The new tag push will *automatically* trigger the Vercel deployment (once Phase 3 is implemented).

## 🛑 Deliberately Not Supported

*As defined in `AGENTS.md` and `docs/plugins.md`:*
*   No remote or user-supplied plugins/themes.
*   No shell/pane replacement.
*   This repository is strictly for core development and release management.
