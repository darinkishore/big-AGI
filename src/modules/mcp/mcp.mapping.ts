import type { Tool as SdkTool, CallToolResult, CompatibilityCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MCPTool, MCPToolResult } from './types/mcp.types';

export function mapSdkToolToInternal(tool: SdkTool): MCPTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as unknown as MCPTool['inputSchema'],
  };
}

export function mapSdkCallResultToInternal(result: CallToolResult | CompatibilityCallToolResult): MCPToolResult {
  const content: MCPToolResult['content'] = [];
  // Back-compat: servers on 2024-10-07 may return { toolResult }
  if ((result as any).toolResult !== undefined) {
    const toolResult = (result as any).toolResult;
    const text = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    content.push({ type: 'text', text });
    return { content };
  }

  for (const block of (result as CallToolResult).content ?? []) {
    if ((block as any).type === 'text' && 'text' in (block as any)) {
      content.push({ type: 'text', text: (block as any).text as string });
      continue;
    }
    if ((block as any).type === 'image' && 'data' in (block as any)) {
      content.push({ type: 'image', data: (block as any).data as string, mimeType: (block as any).mimeType as string });
      continue;
    }
    if ((block as any).type === 'resource_link' && 'uri' in (block as any)) {
      content.push({ type: 'resource', uri: (block as any).uri as string, mimeType: (block as any).mimeType as string | undefined });
      continue;
    }
    if ((block as any).type === 'resource' && 'resource' in (block as any)) {
      const res = (block as any).resource as { uri: string; text?: string; mimeType?: string };
      if (res.text) {
        content.push({ type: 'text', text: res.text });
      } else {
        content.push({ type: 'resource', uri: res.uri, mimeType: res.mimeType });
      }
      continue;
    }
  }
  return { content, isError: (result as any).isError as boolean | undefined };
}
