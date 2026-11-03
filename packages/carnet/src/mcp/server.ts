import { type CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Carnet } from '../carnet.ts';
import { openCarnet, type OpenCarnetOptions } from '../carnet.ts';
import { CarnetError } from '../errors.ts';
import { INSTRUCTIONS } from './instructions.ts';
import {
  createSessionResolver,
  type SessionResolver,
  type SessionResolverOptions,
} from './session.ts';
import { TOOLS } from './tools.ts';

export const SERVER_NAME = 'carnet';
export const SERVER_VERSION = '0.0.0';

export interface CarnetServerOptions extends Omit<SessionResolverOptions, 'carnet'> {
  carnet: Carnet | (() => Carnet);
}

function errorResult(error: CarnetError): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `${error.code}: ${error.message}` }] };
}

export function createCarnetServer(options: CarnetServerOptions): McpServer {
  let carnet: Carnet | undefined;
  let resolver: SessionResolver | undefined;
  const open = (): { carnet: Carnet; resolver: SessionResolver } => {
    carnet ??= typeof options.carnet === 'function' ? options.carnet() : options.carnet;
    resolver ??= createSessionResolver({ ...options, carnet });
    return { carnet, resolver };
  };
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      (args: Record<string, unknown>): CallToolResult => {
        try {
          const { carnet, resolver } = open();
          const sessionId = resolver.resolve(args.session as string | undefined);
          const out = tool.run(carnet, sessionId, args);
          return { content: [{ type: 'text', text: out.text }] };
        } catch (error) {
          if (error instanceof CarnetError) return errorResult(error);
          throw error;
        }
      },
    );
  }
  return server;
}

export interface ServeCarnetOptions extends OpenCarnetOptions {
  carnet?: Carnet;
  ppid?: number;
}

export function serveCarnet(options: ServeCarnetOptions = {}): StdioServerHandle {
  const carnet = options.carnet ?? (() => openCarnet(options));
  return serveStdio(
    () => createCarnetServer({ carnet, env: options.env, ppid: options.ppid, cwd: options.cwd }),
    { onerror: (error) => console.error(`[carnet] ${error.message}`) },
  );
}
