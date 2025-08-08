import { z } from 'zod';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, publicProcedure } from '~/server/trpc/trpc.server';
import { env } from '~/server/env';
import { MCPConnectionManager } from './server/MCPConnectionManager';
import type { MCPTool, MCPToolCall, MCPToolResult } from './types/mcp.types';

// Input schemas
const mcpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  transport: z.enum(['stdio', 'sse']).optional(),
});

const mcpToolCallSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

// Get the singleton connection manager instance
const connectionManager = MCPConnectionManager.getInstance();

// Presets and helpers to merge default args/env/transport when users provide partial configs
function getPresets() {
  return [
    {
      id: 'filesystem',
      name: 'Filesystem (Read/Write Files)',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        transport: 'stdio' as const,
      },
    },
    {
      id: 'github',
      name: 'GitHub (Browse Repos)',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        transport: 'stdio' as const,
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
        },
      },
    },
    {
      id: 'sqlite',
      name: 'SQLite (Database Queries)',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/tmp/test.db'],
        transport: 'stdio' as const,
      },
    },
    {
      id: 'puppeteer',
      name: 'Web Browser (Puppeteer)',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        transport: 'stdio' as const,
      },
    },
  ];
}

function applyPresetDefaults(serverId: string, config: z.infer<typeof mcpServerConfigSchema>): z.infer<typeof mcpServerConfigSchema> {
  const preset = getPresets().find((p) => p.id === serverId);
  if (!preset) return config;
  const mergedEnv = { ...(preset.config.env || {}), ...(config.env || {}) } as Record<string, string>;
  const args = config.args && config.args.length > 0 ? config.args : preset.config.args;
  return {
    command: config.command || preset.config.command,
    args,
    env: Object.keys(mergedEnv).length ? mergedEnv : undefined,
    transport: config.transport || preset.config.transport,
  };
}

export const mcpRouter = createTRPCRouter({
  /**
   * List available MCP tools from a server
   */
  listTools: publicProcedure
    .input(
      z.object({
        serverId: z.string(),
        config: mcpServerConfigSchema,
      }),
    )
    .query(async ({ input }): Promise<{ tools: MCPTool[] }> => {
      try {
        // Apply preset defaults (fills args/env/transport if omitted)
        const cfg = applyPresetDefaults(input.serverId, input.config);
        const connection = await connectionManager.connect(input.serverId, cfg);
        return { tools: connection.tools };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  /**
   * Call an MCP tool
   */
  callTool: publicProcedure.input(mcpToolCallSchema).mutation(async ({ input }): Promise<MCPToolResult> => {
    try {
      const result = await connectionManager.callTool(input.serverId, {
        name: input.name,
        arguments: input.arguments,
      });
      return result;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to call tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }),

  /**
   * Validate an MCP server configuration by attempting to connect
   */
  validateServer: publicProcedure
    .input(
      z.object({
        config: mcpServerConfigSchema,
      }),
    )
    .mutation(async ({ input }): Promise<{ valid: boolean; error?: string }> => {
      const testServerId = `test-${Date.now()}`;
      try {
        const cfg = applyPresetDefaults(testServerId.replace(/^test-/, ''), input.config);
        await connectionManager.connect(testServerId, cfg);
        // If successful, disconnect immediately
        await connectionManager.disconnect(testServerId);
        return { valid: true };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }),

  /**
   * Get available MCP server presets
   */
  getServerPresets: publicProcedure.query(
    async (): Promise<{ presets: Array<{ id: string; name: string; config: z.infer<typeof mcpServerConfigSchema> }> }> => {
      const presets = getPresets();
      return { presets };
    },
  ),

  /**
   * Get all connected MCP servers and their tools
   */
  getConnectedServers: publicProcedure.query(async (): Promise<{ servers: Array<{ serverId: string; tools: MCPTool[] }> }> => {
    const connections = connectionManager.getAllConnections();
    return {
      servers: connections
        .filter((conn) => conn.status === 'connected')
        .map((conn) => ({
          serverId: conn.id,
          tools: conn.tools,
        })),
    };
  }),

  /**
   * Load MCP server definitions from a JSON configuration file.
   * Compatible with common formats like Cursor's ~/.cursor/mcp.json:
   * {
   *   "mcpServers": {
   *     "filesystem": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/tmp"], "transport": "stdio", "env": { } }
   *   }
   * }
   * Also supports a nested transport object: { transport: { type: 'stdio', command, args, env } }
   */
  getServersFromConfig: publicProcedure
    .input(z.object({ path: z.string().optional() }).optional())
    .query(async ({ input }): Promise<{ servers: Array<{ id: string; config: z.infer<typeof mcpServerConfigSchema> }> }> => {
      const explicitPath = input?.path;
      const defaultPath = process.env.MCP_CONFIG_PATH || path.join(os.homedir(), '.cursor', 'mcp.json');
      const filePath = explicitPath || defaultPath;

      let jsonRaw: string;
      try {
        jsonRaw = await fs.readFile(filePath, 'utf-8');
      } catch (e: any) {
        // File not found or unreadable; return empty
        return { servers: [] };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonRaw);
      } catch (e) {
        return { servers: [] };
      }

      const root = parsed?.mcpServers || parsed?.servers || parsed;
      if (!root || typeof root !== 'object') return { servers: [] };

      const servers: Array<{ id: string; config: z.infer<typeof mcpServerConfigSchema> }> = [];
      for (const [id, entry] of Object.entries<any>(root)) {
        let command: string | undefined;
        let args: string[] | undefined;
        let envVars: Record<string, string> | undefined;
        let transport: 'stdio' | 'sse' | undefined;

        if (entry?.transport && typeof entry.transport === 'object' && entry.transport.type) {
          // Nested transport object
          transport = entry.transport.type;
          command = entry.transport.command;
          args = entry.transport.args;
          envVars = entry.transport.env;
        } else {
          // Flat format
          transport = entry.transport;
          command = entry.command;
          args = entry.args;
          envVars = entry.env;
        }

        if (!command) continue;
        const cfg = {
          command,
          ...(Array.isArray(args) ? { args } : {}),
          ...(envVars && typeof envVars === 'object' ? { env: envVars as Record<string, string> } : {}),
          ...(transport === 'stdio' || transport === 'sse' ? { transport } : {}),
        } as z.infer<typeof mcpServerConfigSchema>;

        servers.push({ id, config: cfg });
      }

      return { servers };
    }),

  /**
   * Connect to an MCP server
   */
  connectServer: publicProcedure
    .input(
      z.object({
        serverId: z.string(),
        config: mcpServerConfigSchema,
      }),
    )
    .mutation(async ({ input }): Promise<{ success: boolean; error?: string }> => {
      try {
        const cfg = applyPresetDefaults(input.serverId, input.config);
        await connectionManager.connect(input.serverId, cfg);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }),

  /**
   * Disconnect from an MCP server
   */
  disconnectServer: publicProcedure
    .input(
      z.object({
        serverId: z.string(),
      }),
    )
    .mutation(async ({ input }): Promise<void> => {
      await connectionManager.disconnect(input.serverId);
    }),
});
