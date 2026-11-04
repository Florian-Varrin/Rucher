---
'@rucher/carnet': minor
'@rucher/cli': minor
---

Groups are managed by `rucher` and usable from anywhere: a group is a source in `~/.config/rucher/groups/<name>/` (`group.json`, `CLAUDE.md`) and a workspace in `~/.local/share/rucher/workspaces/<name>/` where its sessions run, every group shares one Carnet database, and every group command takes `-g, --group`. New `rucher groups create|rename|drop` and `rucher group edit|path`; `rucher init`, the group registry and `groups forget|prune` are removed. Sessions keep their group and their launch directory whatever the cwd does, and notes are numbered per group
