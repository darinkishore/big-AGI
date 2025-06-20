import * as React from 'react';

import { Alert, Box, Button, Card, Divider, FormControl, FormHelperText, FormLabel, IconButton, Input, Option, Select, Stack, Switch, Typography } from '@mui/joy';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { FormInputKey } from '~/common/components/forms/FormInputKey';
import { InlineError } from '~/common/components/InlineError';
import { Link } from '~/common/components/Link';

import { useMCPStore } from './store-module-mcp';
import { useMCPServerPresets, useValidateMCPServer } from './mcp.client';
import type { MCPServerConfig } from './types/mcp.types';

export function MCPSettings() {
  const { servers, addServer, updateServer, removeServer, connectServer, disconnectServer, connections, availableTools } = useMCPStore();
  const { data: presets } = useMCPServerPresets();
  const validateMutation = useValidateMCPServer();

  const [newServerName, setNewServerName] = React.useState('');
  const [newServerCommand, setNewServerCommand] = React.useState('');
  const [selectedPreset, setSelectedPreset] = React.useState<string>('');

  const handleAddServer = React.useCallback(() => {
    if (!newServerName || !newServerCommand) return;

    const serverId = `mcp-${Date.now()}`;
    const config: MCPServerConfig = {
      command: newServerCommand,
      args: [],
      env: {},
      transport: 'stdio',
    };

    addServer({
      id: serverId,
      name: newServerName,
      config,
      enabled: false,
    });

    setNewServerName('');
    setNewServerCommand('');
    setSelectedPreset('');
  }, [newServerName, newServerCommand, addServer]);

  const handlePresetChange = React.useCallback((value: string | null) => {
    if (!value || !presets) return;
    
    const preset = presets.presets.find((p: any) => p.id === value);
    if (preset) {
      setSelectedPreset(value);
      setNewServerName(preset.name);
      setNewServerCommand(preset.config.command);
    }
  }, [presets]);

  const handleToggleServer = React.useCallback(async (serverId: string, enabled: boolean) => {
    updateServer(serverId, { enabled });
    
    if (enabled) {
      try {
        await connectServer(serverId);
      } catch (error) {
        console.error('Failed to connect to MCP server:', error);
        updateServer(serverId, { enabled: false });
      }
    } else {
      await disconnectServer(serverId);
    }
  }, [updateServer, connectServer, disconnectServer]);

  const handleValidateServer = React.useCallback(async (config: MCPServerConfig) => {
    const result = await validateMutation.mutateAsync({ config });
    return result;
  }, [validateMutation]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box>
        <Typography level='title-md'>Model Context Protocol (MCP)</Typography>
        <Typography level='body-sm' sx={{ mt: 0.5 }}>
          Connect to MCP servers to extend AI capabilities with tools and resources.{' '}
          <Link href='https://modelcontextprotocol.io' target='_blank'>
            Learn more
          </Link>
        </Typography>
      </Box>

      {/* Add New Server */}
      <Card variant='outlined'>
        <Typography level='title-sm' startDecorator={<AddIcon />}>
          Add MCP Server
        </Typography>
        
        <Stack spacing={2}>
          {presets && (
            <FormControl>
              <FormLabel>Preset</FormLabel>
              <Select
                value={selectedPreset}
                onChange={(_, value) => handlePresetChange(value)}
                placeholder='Choose a preset...'
              >
                {presets.presets.map((preset: any) => (
                  <Option key={preset.id} value={preset.id}>
                    {preset.name}
                  </Option>
                ))}
              </Select>
              <FormHelperText>
                Select a preset configuration or enter custom settings below
              </FormHelperText>
            </FormControl>
          )}

          <FormControl>
            <FormLabel>Server Name</FormLabel>
            <Input
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              placeholder='e.g., Filesystem Tools'
            />
          </FormControl>

          <FormControl>
            <FormLabel>Command</FormLabel>
            <Input
              value={newServerCommand}
              onChange={(e) => setNewServerCommand(e.target.value)}
              placeholder='e.g., npx @modelcontextprotocol/server-filesystem'
              slotProps={{
                input: {
                  sx: { fontFamily: 'code' }
                }
              }}
            />
            <FormHelperText>
              The command to start the MCP server
            </FormHelperText>
          </FormControl>

          <Button
            variant='solid'
            color='primary'
            onClick={handleAddServer}
            disabled={!newServerName || !newServerCommand}
            startDecorator={<AddIcon />}
          >
            Add Server
          </Button>
        </Stack>
      </Card>

      {/* Configured Servers */}
      {servers.length > 0 && (
        <>
          <Divider />
          <Typography level='title-sm'>Configured Servers</Typography>
          
          {servers.map(server => {
            const connection = connections.get(server.id);
            const isConnected = connection?.status === 'connected';
            const isConnecting = connection?.status === 'connecting';
            const hasError = connection?.status === 'error';
            
            return (
              <Card key={server.id} variant='outlined'>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography level='title-sm'>{server.name}</Typography>
                    <Typography level='body-xs' sx={{ fontFamily: 'code' }}>
                      {server.config.command}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Switch
                      checked={server.enabled}
                      onChange={(e) => handleToggleServer(server.id, e.target.checked)}
                      disabled={isConnecting}
                      color={isConnected ? 'success' : hasError ? 'danger' : 'neutral'}
                    />
                    <IconButton
                      size='sm'
                      color='danger'
                      onClick={() => removeServer(server.id)}
                      disabled={server.enabled}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Box>
                
                {hasError && connection?.error && (
                  <Alert color='danger' variant='soft' sx={{ mt: 1 }}>
                    {connection.error}
                  </Alert>
                )}
                
                {isConnected && connection?.serverInfo && (
                  <Box sx={{ mt: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <InfoOutlinedIcon sx={{ fontSize: 'sm', color: 'text.secondary' }} />
                      <Typography level='body-xs'>
                        Connected to {connection.serverInfo.name}
                        {connection.serverInfo.version && ` v${connection.serverInfo.version}`}
                      </Typography>
                    </Box>
                    {servers.find(s => s.id === server.id) && (
                      <Box sx={{ mt: 0.5, ml: 2.5 }}>
                        <Typography level='body-xs' sx={{ color: 'text.secondary' }}>
                          Available tools: {availableTools.get(server.id)?.length || 0}
                        </Typography>
                        {availableTools.get(server.id)?.slice(0, 3).map((tool, idx) => (
                          <Typography key={idx} level='body-xs' sx={{ ml: 1, color: 'text.tertiary' }}>
                            • {tool.name}
                          </Typography>
                        ))}
                        {(availableTools.get(server.id)?.length || 0) > 3 && (
                          <Typography level='body-xs' sx={{ ml: 1, color: 'text.tertiary' }}>
                            • ... and {(availableTools.get(server.id)?.length || 0) - 3} more
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
              </Card>
            );
          })}
        </>
      )}

      {/* Info */}
      <Alert variant='soft' color='primary'>
        <Box>
          <Typography level='body-sm'>
            MCP servers extend AI capabilities with tools for file access, web browsing, database queries, and more.
          </Typography>
          <Typography level='body-sm' sx={{ mt: 1 }}>
            <strong>Quick Test:</strong> Add the &quot;Filesystem&quot; preset above, toggle it ON, then ask the AI to &quot;Create a file at /tmp/hello.txt with &apos;Hello MCP!&apos;&quot; or &quot;Read the file at /tmp/hello.txt&quot;
          </Typography>
        </Box>
      </Alert>
    </Box>
  );
}