# @rucher/cli

The `rucher` binary: status, journal and sessions of your Claude Code sub-agents, from the terminal. Built on [`@rucher/carnet`](../carnet).

```bash
rucher init --name shop --repos ~/code/shop-api,~/code/shop-web
rucher status --watch     # the status pane
rucher log                # the journal
rucher sessions           # named sessions
rucher resume shop-auth   # back into a named session
rucher serve              # the Carnet MCP server, started by the Claude Code plugin
```

See the repository [README](../../README.md) for install and the plugin, and `docs/carnet-spec.md` for every command.
