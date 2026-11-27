# Worktree View

[中文文档](README.md) · [MIT License](LICENSE) · [Contributing](CONTRIBUTING.md)

Review uncommitted changes across Git worktrees in one VS Code window, grouped by feature. The extension adds a Source Control tree; it does not replace your workspace folders or native Git views.

**Early 0.x release, validated on macOS.** Windows, Linux and remote environments have not received full platform validation. A macOS/Linux CI workflow is included; check the actual results in [Actions](https://github.com/gisard/worktree-review/actions).

```text
Feature
  api       feat/login
    Staged
      login.ts
    Unstaged
      session.ts
  web       feat/login
    Untracked
      Login.vue
```

## Install

Requires VS Code 1.96+ and Git. End users do not need Node.js or npm.

Use the packaged installation ZIP or VSIX. Once published, these will be attached to GitHub Releases; the repository's source ZIP is not an installable extension. See [GitHub Releases](https://github.com/gisard/worktree-review/releases) for published assets when available. This initial source push does not create a Release or Marketplace listing.

- macOS: extract the installation ZIP and double-click `install.command`.
- Windows: `install.cmd` (not yet platform-tested).
- Linux: `sh install.sh` (not yet platform-tested).
- All desktop platforms: use **Extensions: Install from VSIX** in the intended VS Code profile or remote window.

Open a trusted project and run **worktree 视图: 打开视图** from the command palette, or click the first-run notification. Existing windows may require **Developer: Reload Window** after upgrading. The UI is currently in Chinese.

The extension ID remains `local-tools.worktree-review` for upgrade compatibility; this is not a registered Marketplace publisher claim.

## Behavior

- Discovers linked worktrees using Git's worktree registry, including external locations. Main checkouts and ordinary repositories serve only as discovery seeds and are not displayed.
- Supports `.worktrees/<feature>/<repository>` and `.worktrees/<branch>`. Directory grouping is a convention, not a universal inference of task relationships. Unrelated same-named branches are not merged. Use custom groups for ambiguous layouts.
- Separates staged, unstaged, untracked and conflicted files. Counts unique changed files; committed branch differences are not included.
- Opens native VS Code diffs and preserves unsaved edits. Immutable Git snapshots can be restored across restarts while the repository and objects still exist.
- Refreshes on relevant events, with 700 ms debouncing and a 15-second visible-view fallback. Does not fetch, stage, commit, switch branches, or delete worktrees.
- Uses the active file icon theme and Git decoration colors. Custom Tree View styling does not reproduce every native SCM visual detail.
- No runtime npm dependencies or built-in telemetry. Snapshot metadata stores repository paths and blob IDs locally, not file contents. See [SECURITY.md](SECURITY.md).

Scan limits, failure states, submodules, binary files and settings are documented in the [Chinese README](README.md).

## Develop and reuse

Use Node.js 22, npm and Git. ZIP packaging requires `zip` on macOS/Linux or PowerShell on Windows.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run bundle
```

F5 launches an extension development window. The CI workflow runs type checks, Node tests and packaging; native extension-host tests are a separate validation step described in the Chinese README.

The source can be forked and reused under MIT. This is a VS Code extension, not a published npm library; internal TypeScript modules and the activation return value are not a stable public API.
