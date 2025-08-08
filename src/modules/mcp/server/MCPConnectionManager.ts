import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { appEvents } from '~/common/events';
import '~/modules/mcp/events.mcp'; // Import for type augmentation

import type { MCPTool, MCPToolCall, MCPToolResult, MCPServerConfig, MCPServerCapabilities } from '../types/mcp.types';

// SDK client & transport from official package (ESM paths)
import { Client as SdkClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { mapSdkCallResultToInternal, mapSdkToolToInternal } from '../mcp.mapping';

export interface MCPServerConnection {
  id: string;
  config: MCPServerConfig;
  client: SdkClient | null;
  transport: StdioClientTransport | null;
  serverInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: MCPServerCapabilities;
  tools: MCPTool[];
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
  lastActivity: number;
}

export class MCPConnectionManager extends EventEmitter {
  private static instance: MCPConnectionManager;
  private connections: Map<string, MCPServerConnection> = new Map();
  private readonly IDLE_TIMEOUT = 300000; // 5 minutes
  private idleCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    // Start idle connection cleanup
    this.idleCheckInterval = setInterval(() => this.cleanupIdleConnections(), 60000); // Check every minute
  }

  static getInstance(): MCPConnectionManager {
    if (!MCPConnectionManager.instance) {
      MCPConnectionManager.instance = new MCPConnectionManager();
    }
    return MCPConnectionManager.instance;
  }

  async connect(serverId: string, config: MCPServerConfig): Promise<MCPServerConnection> {
    // Check if already connected
    const existing = this.connections.get(serverId);
    if (existing?.status === 'connected') {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Create new connection
    const connection: MCPServerConnection = {
      id: serverId,
      config,
      client: null,
      transport: null,
      tools: [],
      status: 'connecting',
      lastActivity: Date.now(),
    };

    this.connections.set(serverId, connection);

    try {
      // Resolve full path for common commands
      let command = config.command;
      if (command === 'npx' || command === 'node' || command === 'npm') {
        try {
          const { stdout } = await execAsync(`which ${command}`);
          const resolvedPath = stdout.trim();
          if (resolvedPath) {
            console.log(`[MCP] Resolved ${command} to: ${resolvedPath}`);
            appEvents.emit('mcp', 'serverLog', {
              serverId,
              level: 'info',
              message: `Resolved ${command} to: ${resolvedPath}`,
              source: 'internal',
            });
            command = resolvedPath;
          }
        } catch (e) {
          console.log(`[MCP] Could not resolve path for ${command}, using as-is`);
          appEvents.emit('mcp', 'serverLog', {
            serverId,
            level: 'info',
            message: `Could not resolve path for ${command}, using as-is`,
            source: 'internal',
          });
        }
      }

      // Prepare SDK transport and client
      console.log(`[MCP] Spawning server ${serverId}:`, {
        command,
        args: config.args,
        env: Object.keys(config.env || {}),
      });
      appEvents.emit('mcp', 'serverLog', {
        serverId,
        level: 'info',
        message: `Spawning server: ${command}`,
        details: { command, args: config.args },
        source: 'internal',
      });

      const transport = new StdioClientTransport({
        command,
        args: config.args ?? [],
        env: config.env,
        stderr: 'pipe',
      });

      // Wire stderr to app logs as early as possible
      const stderr = transport.stderr;
      if (stderr) {
        stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          let level: 'info' | 'warn' | 'error' = 'info';
          const lc = message.toLowerCase();
          if (lc.includes('error') || lc.includes('failed')) level = 'error';
          else if (lc.includes('warn')) level = 'warn';
          appEvents.emit('mcp', 'serverLog', {
            serverId,
            level,
            message,
            source: 'stderr',
          });
        });
      }

      // Create SDK client with latest protocol via SDK and capabilities
      const client = new SdkClient(
        { name: 'big-AGI', version: '1.0.0' },
        {
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
            elicitation: {},
          },
        },
      );

      // Track activity on any message
      const onAnyMessage = (_msg: JSONRPCMessage) => {
        connection.lastActivity = Date.now();
      };
      transport.onmessage = onAnyMessage;
      transport.onerror = (error) => {
        connection.status = 'error';
        connection.error = error.message;
        this.emit('error', serverId, error);
        appEvents.emit('mcp', 'serverError', { serverId, error: error.message });
      };
      transport.onclose = () => {
        const reason = 'Transport closed';
        connection.status = 'disconnected';
        connection.error = reason;
        appEvents.emit('mcp', 'serverDisconnected', { serverId, reason });
      };

      await client.connect(transport);

      connection.client = client;
      connection.transport = transport;
      connection.status = 'connected';

      // Copy server info and capabilities
      connection.serverInfo = client.getServerVersion();
      connection.capabilities = client.getServerCapabilities();

      // List available tools via SDK and map to internal type
      if (connection.capabilities?.tools) {
        const { tools } = await client.listTools();
        connection.tools = tools.map(mapSdkToolToInternal);
      }

      this.emit('connected', serverId, connection);
      appEvents.emit('mcp', 'serverConnected', {
        serverId,
        serverInfo: connection.serverInfo,
        capabilities: connection.capabilities,
      });
      return connection;
    } catch (error) {
      connection.status = 'error';
      connection.error = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', serverId, error);
      appEvents.emit('mcp', 'serverError', {
        serverId,
        error: connection.error,
        fatal: true,
      });
      throw error;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    connection.status = 'disconnected';
    try {
      await connection.client?.close();
    } catch {}
    try {
      await connection.transport?.close();
    } catch {}
    connection.client = null;
    connection.transport = null;

    this.connections.delete(serverId);
    this.emit('disconnected', serverId);
  }

  async callTool(serverId: string, toolCall: MCPToolCall): Promise<MCPToolResult> {
    const connection = this.connections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      throw new Error('Server not connected');
    }

    connection.lastActivity = Date.now();

    try {
      const result = await connection.client!.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments ?? {},
      });
      return mapSdkCallResultToInternal(result);
    } catch (error) {
      throw error;
    }
  }

  getConnection(serverId: string): MCPServerConnection | undefined {
    return this.connections.get(serverId);
  }

  getAllConnections(): MCPServerConnection[] {
    return Array.from(this.connections.values());
  }

  // SDK handles IO; no manual stdio or request plumbing required

  private cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [serverId, connection] of this.connections) {
      if (connection.status === 'connected' && now - connection.lastActivity > this.IDLE_TIMEOUT) {
        console.log(`Disconnecting idle MCP server: ${serverId}`);
        appEvents.emit('mcp', 'serverLog', {
          serverId,
          level: 'info',
          message: 'Disconnecting idle server',
          source: 'internal',
        });
        this.disconnect(serverId);
      }
    }
  }

  destroy(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    // Disconnect all connections
    for (const serverId of this.connections.keys()) {
      this.disconnect(serverId);
    }
  }
}
