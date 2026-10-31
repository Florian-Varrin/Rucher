# @rucher/carnet

Shared state for Rucher: groups, sessions, agents, the "On the table" line and the event journal, stored in one SQLite database per group (`<meta directory>/.rucher/carnet.db`, via `node:sqlite`).

Used by the `rucher` CLI and the Carnet MCP server. See `docs/carnet-spec.md` at the repository root.

```ts
import { openCarnet } from "@rucher/carnet";

const carnet = openCarnet({ cwd: process.cwd() });
const session = carnet.sessions.default();
if (session) console.log(carnet.status.render(session));
```

## Development

```bash
vp test
vp check
vp pack
```
