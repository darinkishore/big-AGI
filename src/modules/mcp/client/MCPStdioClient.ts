import { spawn, ChildProcess } from 'child_process';
import { MCPClient } from './MCPClient';
import type { MCPNotification, MCPRequest, MCPResponse, MCPServerConfig } from '../types/mcp.types';

export class MCPStdioClient extends MCPClient {
  private process: ChildProcess | null = null;
  private buffer = '';

  async connect(): Promise<void> {
    if (this.process) {
      return;
    }

    const config = this.getConfig();
    
    // Spawn the MCP server process
    this.process = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout (responses from server)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (errors from server)
    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('MCP server error:', data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(`MCP server exited with code ${code} and signal ${signal}`);
      this.handleDisconnect();
    });

    // Handle process errors
    this.process.on('error', (error) => {
      console.error('MCP server process error:', error);
      this.emit('error', error);
      this.handleDisconnect();
    });

    // Now initialize the connection
    await super.connect();
  }

  async disconnect(): Promise<void> {
    await super.disconnect();
    
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    
    this.buffer = '';
  }

  protected sendMessage(message: MCPRequest | MCPNotification): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('MCP server process not connected');
    }

    const json = JSON.stringify(message);
    this.process.stdin.write(json + '\n');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as MCPResponse | MCPNotification;
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse MCP message:', error, 'Line:', line);
        }
      }
    }
  }

  private handleDisconnect(): void {
    this.process = null;
    this.buffer = '';
    this.emit('disconnected');
  }

  private getConfig(): MCPServerConfig {
    return this.config;
  }
}