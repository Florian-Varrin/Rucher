---
'@rucher/cli': patch
---

`rucher status` shows the group instead of the repo-relative cwd on its header: `HH:MM - <session> · <group>`, and `HH:MM - <group>` on top of `--all`, so the database being read is always visible.
