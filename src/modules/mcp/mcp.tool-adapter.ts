import type { AixTools_FunctionCallDefinition } from '~/modules/aix/server/api/aix.wiretypes';
import type { DMessageToolInvocationPart, DMessageToolResponsePart } from '~/common/stores/chat/chat.fragments';
import type { MCPTool, MCPToolCall, MCPToolResult } from './types/mcp.types';

/**
 * Convert an MCP tool to big-AGI's function call definition format
 */
export function mcpToolToFunctionDef(tool: MCPTool, serverId: string): AixTools_FunctionCallDefinition {
  // Ensure the name is valid for the function call format
  const safeName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
  
  return {
    type: 'function_call',
    function_call: {
      name: `mcp_${serverId}_${safeName}`,
      description: tool.description || `MCP tool: ${tool.name}`,
      input_schema: tool.inputSchema ? {
        properties: (tool.inputSchema.properties || {}) as any,
        required: tool.inputSchema.required,
      } : undefined,
    },
  };
}

/**
 * Check if a function name is an MCP tool
 */
export function isMCPTool(functionName: string): boolean {
  return functionName.startsWith('mcp_');
}

/**
 * Parse an MCP tool function name to get server ID and tool name
 */
export function parseMCPToolName(functionName: string): { serverId: string; toolName: string } | null {
  if (!isMCPTool(functionName)) return null;
  
  const parts = functionName.split('_');
  if (parts.length < 3) return null;
  
  const serverId = parts[1];
  const toolName = parts.slice(2).join('_');
  
  return { serverId, toolName };
}

