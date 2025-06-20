import { spawn, ChildProcess, exec } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { appEvents } from '~/common/events/appEvents';
import '~/modules/mcp/events.mcp'; // Import for type augmentation

import type {
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  MCPServerConfig,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MCPServerCapabilities,
} from '../types/mcp.types';

interface PendingRequest {
  resolve: (value: MCPResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface MCPServerConnection {
  id: string;
  config: MCPServerConfig;
  process: ChildProcess | null;
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
  private pendingRequests: Map<string, Map<string | number, PendingRequest>> = new Map();
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds
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
      process: null,
      tools: [],
      status: 'connecting',
      lastActivity: Date.now(),
    };

    this.connections.set(serverId, connection);
    this.pendingRequests.set(serverId, new Map());

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
              source: 'internal'
            });
            command = resolvedPath;
          }
        } catch (e) {
          console.log(`[MCP] Could not resolve path for ${command}, using as-is`);
          appEvents.emit('mcp', 'serverLog', {
            serverId,
            level: 'info',
            message: `Could not resolve path for ${command}, using as-is`,
            source: 'internal'
          });
        }
      }

      // Spawn the MCP server process
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
        source: 'internal'
      });

      const env = { ...process.env, ...config.env };
      const child = spawn(command, config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false, // Critical: prevent shell interpretation of stdin
      });

      connection.process = child;
      console.log(`[MCP] Process spawned with PID: ${child.pid}`);
      appEvents.emit('mcp', 'serverLog', {
        serverId,
        level: 'info',
        message: `Process spawned with PID: ${child.pid}`,
        source: 'internal'
      });

      // Set up stdio handlers
      this.setupStdioHandlers(serverId, child);

      // Wait for process to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Process failed to start'));
        }, 5000);

        child.on('spawn', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Initialize the connection
      const initRequest: MCPInitializeRequest = {
        protocolVersion: '1.0',
        capabilities: {},
        clientInfo: {
          name: 'big-AGI',
          version: '1.0.0',
        },
      };

      const initResponse = await this.sendRequest(serverId, 'initialize', initRequest);
      const initResult = initResponse.result as MCPInitializeResponse;

      connection.serverInfo = initResult.serverInfo;
      connection.capabilities = initResult.capabilities;
      connection.status = 'connected';

      // Send initialized notification
      await this.sendNotification(serverId, 'initialized', {});

      // List available tools
      if (connection.capabilities?.tools) {
        const toolsResponse = await this.sendRequest(serverId, 'tools/list', {});
        connection.tools = (toolsResponse.result as { tools: MCPTool[] }).tools || [];
      }

      this.emit('connected', serverId, connection);
      appEvents.emit('mcp', 'serverConnected', {
        serverId,
        serverInfo: connection.serverInfo,
        capabilities: connection.capabilities
      });
      return connection;
    } catch (error) {
      connection.status = 'error';
      connection.error = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', serverId, error);
      appEvents.emit('mcp', 'serverError', {
        serverId,
        error: connection.error,
        fatal: true
      });
      throw error;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    connection.status = 'disconnected';
    
    if (connection.process) {
      connection.process.kill();
      connection.process = null;
    }

    // Reject all pending requests
    const pendingMap = this.pendingRequests.get(serverId);
    if (pendingMap) {
      for (const [, pending] of pendingMap) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Connection closed'));
      }
      pendingMap.clear();
    }

    this.connections.delete(serverId);
    this.pendingRequests.delete(serverId);
    this.emit('disconnected', serverId);
  }

  async callTool(serverId: string, toolCall: MCPToolCall): Promise<MCPToolResult> {
    const connection = this.connections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      throw new Error('Server not connected');
    }

    connection.lastActivity = Date.now();

    try {
      const response = await this.sendRequest(serverId, 'tools/call', {
        name: toolCall.name,
        arguments: toolCall.arguments || {},
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      return response.result as MCPToolResult;
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

  private setupStdioHandlers(serverId: string, child: ChildProcess): void {
    let buffer = '';

    // Handle stdout (JSON-RPC messages)
    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      // Try to parse complete JSON messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line) as MCPResponse | MCPNotification;
            this.handleMessage(serverId, message);
          } catch (error) {
            console.error('Failed to parse MCP message:', error, line);
          }
        }
      }
    });

    // Handle stderr (logging)
    child.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      console.error(`[MCP] Server ${serverId} stderr:`, message);
      
      // Determine log level based on content
      let level: 'info' | 'warn' | 'error' = 'info';
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        level = 'error';
      } else if (message.toLowerCase().includes('warn') || message.toLowerCase().includes('warning')) {
        level = 'warn';
      }
      
      // Check for the specific error we're debugging
      if (message.includes('command not found') && message.includes('jsonrpc')) {
        console.error(`[MCP] CRITICAL: JSON-RPC being interpreted as shell command!`);
        console.error(`[MCP] This indicates stdin is not properly connected to the MCP server.`);
        level = 'error';
      }
      
      // Emit log event
      appEvents.emit('mcp', 'serverLog', {
        serverId,
        level,
        message,
        source: 'stderr'
      });
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.status = 'disconnected';
        connection.error = `Process exited with code ${code} and signal ${signal}`;
      }
      appEvents.emit('mcp', 'serverDisconnected', {
        serverId,
        reason: `Process exited with code ${code} and signal ${signal}`,
        exitCode: code,
        signal
      });
      this.disconnect(serverId);
    });

    child.on('error', (error) => {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.status = 'error';
        connection.error = error.message;
      }
      this.emit('error', serverId, error);
      appEvents.emit('mcp', 'serverError', {
        serverId,
        error: error.message,
        code: (error as any).code
      });
    });
  }

  private handleMessage(serverId: string, message: MCPResponse | MCPNotification): void {
    if ('id' in message) {
      // This is a response
      const pendingMap = this.pendingRequests.get(serverId);
      const pending = pendingMap?.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(message);
        pendingMap?.delete(message.id);
      }
    } else {
      // This is a notification
      this.emit('notification', serverId, message);
    }
  }

  private async sendRequest(serverId: string, method: string, params?: unknown): Promise<MCPResponse> {
    const connection = this.connections.get(serverId);
    if (!connection?.process?.stdin) {
      throw new Error('Connection not available');
    }

    const id = uuidv4();
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const pendingMap = this.pendingRequests.get(serverId);
      if (!pendingMap) {
        reject(new Error('No pending requests map'));
        return;
      }

      const timer = setTimeout(() => {
        pendingMap.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.REQUEST_TIMEOUT);

      pendingMap.set(id, { resolve, reject, timer });

      try {
        const message = JSON.stringify(request) + '\n';
        console.log(`[MCP] Sending request to ${serverId}:`, { method, id, hasParams: !!params });
        appEvents.emit('mcp', 'requestSent', {
          serverId,
          requestId: id,
          method
        });
        connection.process!.stdin!.write(message);
      } catch (error) {
        console.error(`[MCP] Failed to write to stdin for ${serverId}:`, error);
        appEvents.emit('mcp', 'serverLog', {
          serverId,
          level: 'error',
          message: `Failed to write to stdin: ${error}`,
          details: { method, error },
          source: 'internal'
        });
        pendingMap.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  private async sendNotification(serverId: string, method: string, params?: unknown): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection?.process?.stdin) {
      throw new Error('Connection not available');
    }

    const notification: MCPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    connection.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [serverId, connection] of this.connections) {
      if (connection.status === 'connected' && now - connection.lastActivity > this.IDLE_TIMEOUT) {
        console.log(`Disconnecting idle MCP server: ${serverId}`);
        appEvents.emit('mcp', 'serverLog', {
          serverId,
          level: 'info',
          message: 'Disconnecting idle server',
          source: 'internal'
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