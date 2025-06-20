import { useEffect } from 'react';

import { appEvents } from '~/common/events/appEvents';
import { logger } from '~/common/logger/logger.client';

/**
 * Hook that bridges MCP server-side events to the client-side logger.
 * This allows server logs to appear in the UI's Logger Viewer.
 */
export function useMCPLogBridge() {
  useEffect(() => {
    // Bridge server logs to client logger
    const unsubLog = appEvents.on('mcp', 'serverLog', (event) => {
      const { serverId, level, message, details, source } = event.data;
      const formattedMessage = `[${serverId}] ${message}`;
      
      // Add source info to details if present
      const logDetails = source ? { ...details, source } : details;
      
      switch (level) {
        case 'error':
          logger.error(formattedMessage, logDetails, 'mcp-server');
          break;
        case 'warn':
          logger.warn(formattedMessage, logDetails, 'mcp-server');
          break;
        default:
          logger.info(formattedMessage, logDetails, 'mcp-server');
      }
    });

    // Log connection events
    const unsubConnect = appEvents.on('mcp', 'serverConnected', (event) => {
      const { serverId, serverInfo, capabilities } = event.data;
      logger.info(
        `[${serverId}] Server connected`,
        { 
          serverInfo, 
          capabilities: capabilities ? Object.keys(capabilities) : [] 
        },
        'mcp-server'
      );
    });

    const unsubDisconnect = appEvents.on('mcp', 'serverDisconnected', (event) => {
      const { serverId, reason, exitCode, signal } = event.data;
      logger.warn(
        `[${serverId}] Server disconnected`,
        { reason, exitCode, signal },
        'mcp-server'
      );
    });

    const unsubError = appEvents.on('mcp', 'serverError', (event) => {
      const { serverId, error, code, fatal } = event.data;
      logger.error(
        `[${serverId}] Server error`,
        { error, code, fatal },
        'mcp-server'
      );
    });

    // Optional: Log request tracking for debugging
    const unsubRequest = appEvents.on('mcp', 'requestSent', (event) => {
      const { serverId, requestId, method } = event.data;
      logger.debug(
        `[${serverId}] Request sent: ${method}`,
        { requestId },
        'mcp-server'
      );
    });

    const unsubRequestComplete = appEvents.on('mcp', 'requestCompleted', (event) => {
      const { serverId, requestId, method, duration, error } = event.data;
      if (error) {
        logger.warn(
          `[${serverId}] Request failed: ${method}`,
          { requestId, duration, error },
          'mcp-server'
        );
      } else {
        logger.debug(
          `[${serverId}] Request completed: ${method}`,
          { requestId, duration },
          'mcp-server'
        );
      }
    });

    // Cleanup
    return () => {
      unsubLog();
      unsubConnect();
      unsubDisconnect();
      unsubError();
      unsubRequest();
      unsubRequestComplete();
    };
  }, []);
}