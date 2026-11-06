# @rucher/cli

The `rucher` binary: status, journal and sessions of your Claude Code sub-agents, from the terminal. Built on [`@rucher/carnet`](https://www.npmjs.com/package/@rucher/carnet).

```bash
rucher ws create shop --repos ~/code/shop-api,~/code/shop-web
rucher new shop-auth --ws shop   # Claude Code in the workspace's run directory
rucher status --watch --ws shop  # the status pane
rucher log                # the journal
rucher sessions           # named sessions
rucher resume shop-auth   # back into a named session
rucher serve              # the Carnet MCP server, started by the Claude Code plugin
```

Install: `npm install -g @rucher/cli`. See the repository [README](https://github.com/Florian-Varrin/Rucher#readme) for the Claude Code plugin and workspaces, and [`docs/reference.md`](https://github.com/Florian-Varrin/Rucher/blob/master/docs/reference.md) for every command.
