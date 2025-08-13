import { MCPConnectionManager } from '../server/MCPConnectionManager';

// NOTE: This test spawns `@modelcontextprotocol/server-everything` via npx.
// Ensure network and npx access in CI, or skip with E2E flag if needed.

const serverId = 'everything';

const config = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  transport: 'stdio' as const,
};

describe('MCP everything server (SDK stdio)', () => {
  const manager = MCPConnectionManager.getInstance();

  afterAll(async () => {
    try {
      await manager.disconnect(serverId);
    } catch {
      // ignore
    }
    // Ensure internal intervals and transports are cleaned up
    manager.destroy();
  });

  it('connects and lists tools', async () => {
    const conn = await manager.connect(serverId, config);
    expect(conn.status).toBe('connected');
    expect(conn.serverInfo?.name).toBeTruthy();

    const { tools } = await (async () => {
      // connection already performs listTools on connect; read from state
      return { tools: conn.tools };
    })();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Try calling a tool defensively. Many tools may require specific args.
    // We won't fail the test if the call errors; the connection and listing are the main checks.
    const candidate = tools[0];
    expect(candidate?.name).toBeTruthy();
    try {
      const result = await manager.callTool(serverId, {
        name: candidate.name,
        arguments: {},
      });
      expect(result).toBeTruthy();
      expect(Array.isArray(result.content)).toBe(true);
    } catch {
      // acceptable: some tools require arguments
    }
  });
});
