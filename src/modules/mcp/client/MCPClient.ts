import { EventEmitter } from 'eventemitter3';
import type {
  MCPConnection,
  MCPError,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MCPNotification,
  MCPPrompt,
  MCPRequest,
  MCPResource,
  MCPResponse,
  MCPServerConfig,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
} from '../types/mcp.types';

interface MCPClientEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  notification: (notification: MCPNotification) => void;
}

export abstract class MCPClient extends EventEmitter<MCPClientEvents> {
  private serverId: string;
  protected config: MCPServerConfig;
  private connection: MCPConnection;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();

  constructor(serverId: string, config: MCPServerConfig) {
    super();
    this.serverId = serverId;
    this.config = config;
    this.connection = {
      serverId,
      status: 'disconnected',
    };
  }

  getConnection(): MCPConnection {
    return { ...this.connection };
  }

  async connect(): Promise<void> {
    if (this.connection.status === 'connected') {
      return;
    }

    this.connection.status = 'connecting';

    try {
      // Initialize the connection
      const initRequest: MCPInitializeRequest = {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true,
          },
          sampling: {},
        },
        clientInfo: {
          name: 'big-agi',
          version: '1.0.0',
        },
      };

      const initResponse = await this.request<MCPInitializeResponse>('initialize', initRequest);
      
      this.connection.serverInfo = initResponse.serverInfo;
      this.connection.capabilities = initResponse.capabilities;
      this.connection.status = 'connected';

      // Notify initialized
      await this.notify('notifications/initialized', {});

      this.emit('connected');
    } catch (error) {
      this.connection.status = 'error';
      this.connection.error = error instanceof Error ? error.message : String(error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection.status === 'disconnected') {
      return;
    }

    try {
      // Clean up pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('Client disconnecting'));
      }
      this.pendingRequests.clear();

      this.connection.status = 'disconnected';
      this.emit('disconnected');
    } catch (error) {
      console.error('Error during disconnect:', error);
    }
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.connection.capabilities?.tools) {
      return [];
    }

    const response = await this.request<{ tools: MCPTool[] }>('tools/list', {});
    return response.tools || [];
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    const response = await this.request<MCPToolResult>('tools/call', call);
    return response;
  }

  async listResources(): Promise<MCPResource[]> {
    if (!this.connection.capabilities?.resources) {
      return [];
    }

    const response = await this.request<{ resources: MCPResource[] }>('resources/list', {});
    return response.resources || [];
  }

  async readResource(uri: string): Promise<string> {
    const response = await this.request<{ contents: Array<{ text?: string }> }>('resources/read', { uri });
    return response.contents?.[0]?.text || '';
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    if (!this.connection.capabilities?.prompts) {
      return [];
    }

    const response = await this.request<{ prompts: MCPPrompt[] }>('prompts/list', {});
    return response.prompts || [];
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<{ messages: Array<{ role: string; content: string }> }> {
    const response = await this.request<{ messages: Array<{ role: string; content: string }> }>('prompts/get', {
      name,
      arguments: args,
    });
    return response;
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Send the request
      this.sendMessage(request);

      // Set a timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000); // 30 second timeout
    });
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const notification: MCPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendMessage(notification);
  }

  protected abstract sendMessage(message: MCPRequest | MCPNotification): void;

  protected handleMessage(message: MCPResponse | MCPNotification): void {
    if ('id' in message) {
      // This is a response
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    } else {
      // This is a notification
      this.emit('notification', message as MCPNotification);
    }
  }
}