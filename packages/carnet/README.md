# @rucher/carnet

Shared state for Rucher: workspaces, sessions, agents, the "On the table" line and the event journal, stored in one SQLite database for every workspace (`~/.local/share/rucher/carnet.db`, via `node:sqlite`), with workspaces defined in `~/.config/rucher/workspaces/<name>/workspace.json`.

Used by the `rucher` CLI and the Carnet MCP server. See [`docs/reference.md`](https://github.com/Florian-Varrin/Rucher/blob/master/docs/reference.md) in the [repository](https://github.com/Florian-Varrin/Rucher).

```ts
import { openCarnet } from '@rucher/carnet';

const carnet = openCarnet({ workspace: 'shop' });
const session = carnet.sessions.default();
if (session) console.log(carnet.status.render(session));
```

## Development

```bash
vp test
vp check
vp pack
```
