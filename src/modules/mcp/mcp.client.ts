import * as React from 'react';
import { apiAsyncNode } from '~/common/util/trpc.client';
import type { MCPTool, MCPToolCall, MCPToolResult, MCPServerConfig } from './types/mcp.types';

// Note: MCP requires Node.js runtime, so we can't use React Query hooks
// These are placeholder exports to maintain API compatibility

/**
 * React hook to list MCP tools from a server
 */
export const useListMCPTools = (serverId: string | null, config: MCPServerConfig | null) => {
  // This would need to be implemented differently for client-side use
  return { data: null, isLoading: false, error: null };
};

/**
 * React hook to call an MCP tool
 */
export const useCallMCPTool = () => {
  return {
    mutate: async (toolCall: MCPToolCall & { serverId: string }) => callMCPTool(toolCall),
    mutateAsync: async (toolCall: MCPToolCall & { serverId: string }) => callMCPTool(toolCall),
  };
};

/**
 * React hook to validate an MCP server configuration
 */
export const useValidateMCPServer = () => {
  return {
    mutateAsync: async (config: { config: MCPServerConfig }) => {
      return apiAsyncNode.mcp.validateServer.mutate(config);
    },
  };
};

/**
 * React hook to get MCP server presets
 */
export const useMCPServerPresets = () => {
  const [data, setData] = React.useState<any>(null);
  
  React.useEffect(() => {
    apiAsyncNode.mcp.getServerPresets.query()
      .then(setData)
      .catch(console.error);
  }, []);
  
  return { data };
};

/**
 * Call an MCP tool directly (non-hook version)
 */
export async function callMCPTool(toolCall: MCPToolCall & { serverId: string }): Promise<MCPToolResult> {
  const result = await apiAsyncNode.mcp.callTool.mutate(toolCall);
  return result;
}

/**
 * List available MCP tools from a server (non-hook version)
 */
export async function listMCPTools(serverId: string, config: MCPServerConfig): Promise<MCPTool[]> {
  const result = await apiAsyncNode.mcp.listTools.query({ serverId, config });
  return result.tools;
}