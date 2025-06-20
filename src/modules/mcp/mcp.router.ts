import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, publicProcedure } from '~/server/trpc/trpc.server';
import { env } from '~/server/env';
import { MCPConnectionManager } from './server/MCPConnectionManager';
import type { MCPTool, MCPToolCall, MCPToolResult } from './types/mcp.types';

// Input schemas
const mcpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  transport: z.enum(['stdio', 'sse']).optional(),
});

const mcpToolCallSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

// Get the singleton connection manager instance
const connectionManager = MCPConnectionManager.getInstance();

export const mcpRouter = createTRPCRouter({
  
  /**
   * List available MCP tools from a server
   */
  listTools: publicProcedure
    .input(z.object({
      serverId: z.string(),
      config: mcpServerConfigSchema,
    }))
    .query(async ({ input }): Promise<{ tools: MCPTool[] }> => {
      try {
        // Connect to the server if not already connected
        const connection = await connectionManager.connect(input.serverId, input.config);
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
  callTool: publicProcedure
    .input(mcpToolCallSchema)
    .mutation(async ({ input }): Promise<MCPToolResult> => {
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
    .input(z.object({
      config: mcpServerConfigSchema,
    }))
    .mutation(async ({ input }): Promise<{ valid: boolean; error?: string }> => {
      const testServerId = `test-${Date.now()}`;
      try {
        // Try to connect to the server
        await connectionManager.connect(testServerId, input.config);
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
  getServerPresets: publicProcedure
    .query(async (): Promise<{ presets: Array<{ id: string; name: string; config: z.infer<typeof mcpServerConfigSchema> }> }> => {
      // Return some common MCP server presets
      return {
        presets: [
          {
            id: 'filesystem',
            name: 'Filesystem (Read/Write Files)',
            config: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
              transport: 'stdio',
            },
          },
          {
            id: 'github',
            name: 'GitHub (Browse Repos)',
            config: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              transport: 'stdio',
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
              transport: 'stdio',
            },
          },
          {
            id: 'puppeteer',
            name: 'Web Browser (Puppeteer)',
            config: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-puppeteer'],
              transport: 'stdio',
            },
          },
        ],
      };
    }),

  /**
   * Get all connected MCP servers and their tools
   */
  getConnectedServers: publicProcedure
    .query(async (): Promise<{ servers: Array<{ serverId: string; tools: MCPTool[] }> }> => {
      const connections = connectionManager.getAllConnections();
      return {
        servers: connections
          .filter(conn => conn.status === 'connected')
          .map(conn => ({
            serverId: conn.id,
            tools: conn.tools,
          })),
      };
    }),

  /**
   * Connect to an MCP server
   */
  connectServer: publicProcedure
    .input(z.object({
      serverId: z.string(),
      config: mcpServerConfigSchema,
    }))
    .mutation(async ({ input }): Promise<{ success: boolean; error?: string }> => {
      try {
        await connectionManager.connect(input.serverId, input.config);
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
    .input(z.object({
      serverId: z.string(),
    }))
    .mutation(async ({ input }): Promise<void> => {
      await connectionManager.disconnect(input.serverId);
    }),
});