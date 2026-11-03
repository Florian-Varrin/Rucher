import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { expect, test } from 'vite-plus/test';
import { createGroup, openCarnet } from '../src/index.ts';
import { createCarnetServer } from '../src/mcp/index.ts';
import { SESSION, tempDirectory } from './helpers.ts';

test('tools return an error when the repo belongs to several groups', async () => {
  const api = tempDirectory('repo-api-');
  const env = { RUCHER_HOME: tempDirectory('home-'), CLAUDE_CODE_SESSION_ID: SESSION };
  createGroup('shop', { env, repos: [api] });
  createGroup('blog', { env, repos: [api] });
  const server = createCarnetServer({
    carnet: () => openCarnet({ cwd: api, env }),
    env,
    cwd: api,
    ppid: 1,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: 'agent_start',
    arguments: { name: 'login-form', task: 'Add the login form' },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toMatch(/GROUP_AMBIGUOUS/);
});
