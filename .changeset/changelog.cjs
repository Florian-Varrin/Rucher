// Summaries starting with "internal:" bump the version (so CI releases) without a changelog line.
const git = require('@changesets/changelog-git').default;

const INTERNAL = /^internal:/i;

module.exports = {
  getReleaseLine: (changeset, type, options) =>
    INTERNAL.test(changeset.summary.trim())
      ? Promise.resolve('')
      : git.getReleaseLine(changeset, type, options),
  getDependencyReleaseLine: git.getDependencyReleaseLine,
};
