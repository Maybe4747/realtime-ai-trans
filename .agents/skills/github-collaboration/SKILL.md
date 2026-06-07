---
name: github-collaboration
description: GitHub collaboration workflow for repositories that develop on dev, commit at key milestones, push suitable commit groups to origin dev, create pull requests from dev to main, merge after checks/review, then fetch origin and rebase dev onto main before continuing. Use when Codex is asked to manage GitHub PRs, dev/main branch collaboration, milestone commits, pushing, merging, or post-merge branch synchronization; prefer the gh CLI when available.
---

# GitHub Collaboration

## Core Rules

- Prefer `gh` for GitHub operations: auth checks, PR creation, PR status, checks, review state, merge.
- Develop on `dev` unless the user names another branch.
- Commit at meaningful milestones. Each commit should contain a coherent, verified change.
- Use the repository's commit convention. If none is present and the user has not said otherwise, use `type<scope>: message`.
- Push `origin dev` after a suitable group of milestone commits, not after every tiny edit unless requested.
- Create PRs from `dev` to `main`.
- Merge only after checks and review state are acceptable, or after the user explicitly approves merging despite warnings.
- After merge, run `git fetch origin`, switch back to `dev`, rebase onto `origin/main`, then continue development from the updated `dev`.
- Do not delete the long-lived `dev` branch unless the user explicitly asks.
- Never overwrite or discard user changes. Before rebasing, pushing, or merging, inspect `git status --short`.

## Preflight

1. Inspect repository state:

```bash
git status --short
git branch --show-current
git remote -v
gh auth status
```

2. If `gh` is unavailable or unauthenticated, state that and use Git commands only for local operations. Ask before attempting GitHub operations without `gh`.
3. If the working tree has unrelated user changes, leave them alone. If they block the requested operation, explain the blocker and ask.
4. Ensure the local branch is `dev`:

```bash
git switch dev
git fetch origin
git rebase origin/main
```

If `dev` does not exist, ask before creating or tracking it.

## Development Loop

For each coherent unit of work:

1. Make the requested code or documentation changes.
2. Run the smallest verification that proves the milestone.
3. Review the diff:

```bash
git diff --stat
git diff
```

4. Stage only files that belong to the milestone.
5. Commit using the expected convention:

```bash
git add <files>
git commit -m "type<scope>: concise message"
```

6. Continue until the current batch is ready to share.

## Push A Batch

Before pushing:

```bash
git status --short
git log --oneline origin/dev..dev
```

If the batch is coherent and verified:

```bash
git push origin dev
```

If local `dev` was rebased after it had already been pushed, use:

```bash
git push --force-with-lease origin dev
```

Use `--force-with-lease` only after confirming the branch is `dev` and the rebase was intentional.

## Create PR

Prefer `gh`:

```bash
gh pr create --base main --head dev --fill
```

If `--fill` produces a weak PR description, edit it with a concise summary, verification results, and risks.

Inspect the PR:

```bash
gh pr view --web
gh pr checks
gh pr status
```

## Merge PR

Before merging:

1. Confirm the PR is `dev -> main`.
2. Confirm checks are passing or the user has approved proceeding.
3. Confirm there are no unresolved review comments or merge conflicts.

Prefer a regular merge to keep `dev` synchronization straightforward:

```bash
gh pr merge --merge
```

If the repository requires squash or rebase merge, follow repo policy, but do not delete `dev`. After squash/rebase merge, be careful to avoid replaying already-merged work onto `dev`; ask before resetting or force-updating shared history.

## Sync And Continue

After a successful merge:

```bash
git fetch origin
git switch dev
git rebase origin/main
git push --force-with-lease origin dev
```

Then continue development on `dev` from the rebased state.

If rebase conflicts occur:

1. Stop and report the conflicted files.
2. Resolve only conflicts related to the current work.
3. Run verification again.
4. Continue with `git rebase --continue`.
5. Push with `--force-with-lease` after a clean rebase.

## Reporting

When reporting progress, include:

- Current branch and PR URL if one exists.
- Commits created in this batch.
- Verification commands and outcomes.
- Whether `origin dev` was pushed.
- Whether the PR was created, merged, and local `dev` rebased onto `origin/main`.
