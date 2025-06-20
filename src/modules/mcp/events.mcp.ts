/**
 * MCP Event Domain Types
 * 
 * These events are used to bridge server-side MCP logs to the client-side logger.
 */

declare module '~/common/events/events.types' {
  interface EventDomains {
    mcp: {
      // Server log events
      serverLog: {
        serverId: string;
        level: 'info' | 'warn' | 'error';
        message: string;
        details?: any;
        source?: 'stdout' | 'stderr' | 'internal';
      };
      
      // Connection lifecycle events
      serverConnected: { 
        serverId: string;
        serverInfo?: {
          name?: string;
          version?: string;
        };
        capabilities?: any;
      };
      
      serverDisconnected: { 
        serverId: string;
        reason?: string;
        exitCode?: number | null;
        signal?: string | null;
      };
      
      // Error events
      serverError: {
        serverId: string;
        error: string;
        fatal?: boolean;
        code?: string;
      };
      
      // Request tracking (optional, for debugging)
      requestSent: {
        serverId: string;
        requestId: string;
        method: string;
      };
      
      requestCompleted: {
        serverId: string;
        requestId: string;
        method: string;
        duration: number;
        error?: string;
      };
    };
  }
}

// Export empty object to make this a module
export {};