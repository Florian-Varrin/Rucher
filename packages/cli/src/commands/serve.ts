import { serveCarnet } from '@rucher/carnet/mcp';
import type { Io } from '../io.ts';

export function serve(io: Io): void {
  serveCarnet({ cwd: io.cwd, env: io.env });
}
