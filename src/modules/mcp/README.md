# Model Context Protocol (MCP) Integration

This module provides integration with the Model Context Protocol (MCP), allowing big-AGI to connect to MCP servers and use their tools.

## Architecture

### Core Components

- **MCPClient**: Base class for MCP client implementations
- **MCPStdioClient**: stdio transport implementation for local MCP servers
- **mcp.router.ts**: tRPC router for server-side MCP operations
- **store-module-mcp.tsx**: Zustand store for managing MCP connections and configuration
- **mcp.tool-adapter.ts**: Adapts MCP tools to big-AGI's function calling system

### Types

All MCP protocol types are defined in `types/mcp.types.ts` following the official MCP specification.

## Usage

### Adding an MCP Server

1. Go to Settings > Model Context Protocol
2. Either select a preset or enter custom server details
3. Enable the server to connect

### Using MCP Tools

Once connected, MCP tools are automatically available to AI models that support function calling. The tools appear with the prefix `mcp_[serverId]_[toolName]`.

## Development

### Adding New MCP Transports

To add support for new transport types (e.g., HTTP, WebSocket):

1. Create a new client class extending `MCPClient`
2. Implement the `sendMessage` method for the transport
3. Handle incoming messages and call `handleMessage`

### Security Considerations

- MCP servers run as separate processes with access to system resources
- Server commands are validated before execution
- Consider using `MCP_ALLOWED_SERVERS` environment variable to restrict allowed commands

## Future Enhancements

- [ ] SSE transport support
- [ ] HTTP transport support  
- [ ] MCP server discovery
- [ ] Resource browsing UI
- [ ] Prompt template support
- [ ] Server connection pooling
- [ ] Advanced debugging tools