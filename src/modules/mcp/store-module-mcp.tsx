import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MCPConnection, MCPServerConfig, MCPTool } from './types/mcp.types';

interface MCPServer {
  id: string;
  name: string;
  config: MCPServerConfig;
  enabled: boolean;
}

interface MCPStore {
  // Server configurations
  servers: MCPServer[];
  addServer: (server: MCPServer) => void;
  updateServer: (id: string, updates: Partial<MCPServer>) => void;
  removeServer: (id: string) => void;

  // Active connections
  connections: Map<string, MCPConnection>;
  
  // Connect/disconnect
  connectServer: (serverId: string) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  
  // Tools
  availableTools: Map<string, MCPTool[]>; // serverId -> tools
  refreshTools: (serverId: string) => Promise<void>;

  // Optional helper: bulk import servers from a JSON file (e.g., ~/.cursor/mcp.json)
  loadServersFromConfig?: (configPath?: string) => Promise<number>;
}

export const useMCPStore = create<MCPStore>()(
  persist(
    (set, get) => {
      // Cache presets to avoid repeated fetches
      let presetsCache: Array<{ id: string; name: string; config: MCPServerConfig }> | null = null;

      async function getPresetsOrFetch(): Promise<Array<{ id: string; name: string; config: MCPServerConfig }>> {
        if (presetsCache) return presetsCache;
        try {
          const { apiAsyncNode } = await import('~/common/util/trpc.client');
          const res = await apiAsyncNode.mcp.getServerPresets.query();
          presetsCache = res.presets as Array<{ id: string; name: string; config: MCPServerConfig }>;
          return presetsCache;
        } catch (e) {
          console.warn('[MCP] Failed to load presets', e);
          presetsCache = [];
          return presetsCache;
        }
      }

      async function mergeDefaultsFromPreset(serverId: string, name: string, config: MCPServerConfig): Promise<MCPServerConfig> {
        const presets = await getPresetsOrFetch();
        const matchById = presets.find(p => p.id === serverId);
        const matchByName = presets.find(p => p.name.toLowerCase() === (name || '').toLowerCase());
        const preset = matchById || matchByName;
        if (!preset) return config;
        const mergedEnv = { ...(preset.config.env || {}), ...(config.env || {}) } as Record<string, string>;
        const args = (config.args && config.args.length > 0) ? config.args : preset.config.args;
        return {
          command: config.command || preset.config.command,
          args,
          env: Object.keys(mergedEnv).length ? mergedEnv : undefined,
          transport: config.transport || preset.config.transport,
        } as MCPServerConfig;
      }

      return ({
      servers: [],
      connections: new Map(),
      availableTools: new Map(),

      addServer: (server) => {
        set((state) => ({
          servers: [...state.servers, server],
        }));
      },

      updateServer: (id, updates) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));
      },

      removeServer: (id) => {
        set((state) => ({
          servers: state.servers.filter((s) => s.id !== id),
        }));
        // Disconnect if connected
        const { disconnectServer } = get();
        disconnectServer(id).catch(console.error);
      },

      connectServer: async (serverId) => {
        const { servers } = get();
        const server = servers.find((s) => s.id === serverId);
        
        if (!server || !server.enabled) {
          throw new Error('Server not found or not enabled');
        }

        try {
          // Use server-side connection through TRPC
          const { apiAsyncNode } = await import('~/common/util/trpc.client');
          // Merge defaults from presets if args/env/transport are missing
          const effectiveConfig = await mergeDefaultsFromPreset(serverId, server.name, server.config);
          // persist merged config locally to avoid future empty-args
          if (effectiveConfig !== server.config) {
            set((state) => ({
              servers: state.servers.map(s => s.id === serverId ? { ...s, config: effectiveConfig } : s),
            }));
          }
          const result = await apiAsyncNode.mcp.connectServer.mutate({ serverId, config: effectiveConfig });

          if (!result.success) {
            throw new Error(result.error || 'Failed to connect');
          }

          // Update connection status
          set((state) => {
            const newConnections = new Map(state.connections);
            newConnections.set(serverId, {
              serverId,
              status: 'connected',
            });
            return { connections: newConnections };
          });

          // Refresh tools after connection
          await get().refreshTools(serverId);
        } catch (error) {
          console.error(`Failed to connect to MCP server ${serverId}:`, error);
          set((state) => {
            const newConnections = new Map(state.connections);
            newConnections.set(serverId, {
              serverId,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            return { connections: newConnections };
          });
          throw error;
        }
      },

      disconnectServer: async (serverId) => {
        try {
          // Use server-side disconnection through TRPC
          const { apiAsyncNode } = await import('~/common/util/trpc.client');
          await apiAsyncNode.mcp.disconnectServer.mutate({ serverId });
          
          // Update local state
          set((state) => {
            const newConnections = new Map(state.connections);
            newConnections.delete(serverId);
            const newTools = new Map(state.availableTools);
            newTools.delete(serverId);
            return { connections: newConnections, availableTools: newTools };
          });
        } catch (error) {
          console.error(`Failed to disconnect from MCP server ${serverId}:`, error);
        }
      },

      refreshTools: async (serverId) => {
        const { servers } = get();
        const server = servers.find((s) => s.id === serverId);
        
        if (!server) {
          throw new Error('Server not found');
        }

        try {
          // Use server-side tool listing through TRPC
          const { apiAsyncNode } = await import('~/common/util/trpc.client');
          const effectiveConfig = await mergeDefaultsFromPreset(serverId, server.name, server.config);
          if (effectiveConfig !== server.config) {
            set((state) => ({
              servers: state.servers.map(s => s.id === serverId ? { ...s, config: effectiveConfig } : s),
            }));
          }
          const result = await apiAsyncNode.mcp.listTools.query({ serverId, config: effectiveConfig });
          
          set((state) => {
            const newTools = new Map(state.availableTools);
            newTools.set(serverId, result.tools);
            return { availableTools: newTools };
          });
        } catch (error) {
          console.error(`Failed to refresh tools for ${serverId}:`, error);
        }
      },

      // Add servers from a JSON config without enabling them
      loadServersFromConfig: async (configPath?: string) => {
        try {
          const { apiAsyncNode } = await import('~/common/util/trpc.client');
          const result = await apiAsyncNode.mcp.getServersFromConfig.query({ path: configPath });
          const serversToAdd = (result.servers || []).map((s: any) => ({ id: s.id, name: s.id, config: s.config, enabled: false }));
          if (!serversToAdd.length) return 0;
          let added = 0;
          set((state) => {
            const existingIds = new Set(state.servers.map(s => s.id));
            const newOnes = serversToAdd.filter(s => !existingIds.has(s.id));
            added = newOnes.length;
            return { servers: [...state.servers, ...newOnes] };
          });
          return added;
        } catch (e) {
          console.error('Failed to load MCP servers from config', e);
          return 0;
        }
      },
    });
    {
      name: 'mcp-store',
      partialize: (state) => ({
        servers: state.servers,
      }),
    }
  )
);