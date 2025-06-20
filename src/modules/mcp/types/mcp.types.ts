/**
 * Model Context Protocol (MCP) Types
 * Based on the MCP specification
 */

// Base types
export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// Tool types
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface MCPToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

// Resource types
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// Prompt types
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

// Server capabilities
export interface MCPServerCapabilities {
  tools?: {};
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

// Client capabilities
export interface MCPClientCapabilities {
  experimental?: Record<string, unknown>;
  roots?: {
    listChanged?: boolean;
  };
  sampling?: {};
}

// Protocol messages
export interface MCPInitializeRequest {
  protocolVersion: string;
  capabilities: MCPClientCapabilities;
  clientInfo: {
    name: string;
    version?: string;
  };
}

export interface MCPInitializeResponse {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: {
    name: string;
    version?: string;
  };
}

// Connection types
export type MCPTransport = 'stdio' | 'sse';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: MCPTransport;
}

export interface MCPConnection {
  serverId: string;
  serverInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: MCPServerCapabilities;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}