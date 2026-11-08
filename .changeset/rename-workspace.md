---
'@rucher/carnet': minor
'@rucher/cli': minor
---

Rename groups to workspaces: `rucher ws` replaces `group` and `groups`, `--ws` and `RUCHER_WS` replace `-g`, `--group` and `RUCHER_GROUP`, definitions move to `~/.config/rucher/workspaces/` with `workspace.json`, `ws path` takes `--def` and `--run`, and `--ws` also works before a subcommand. `ws rename` is out until it can move a run directory.
