# Changesets

Every change that should ship comes with a changeset: run `pnpm changeset`, pick the packages (`@rucher/carnet`, `@rucher/cli`) and the bump, and write a one-line summary for the changelog.

Start the summary with `internal:` when the change needs a release but no changelog line.

Pushing to `master` releases whatever the pending changesets describe; a push without one fails the release workflow. See "Releasing" in the root README.
