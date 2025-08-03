import WebSocket, { WebSocketServer } from 'ws';
import { normalizeWorkspacePath, areWorkspacePathsEqual, areWorkspacePathsRelated, generateSessionId } from './path-utils.js';

/**
 * Shared WebSocket Router for Interactive MCP
 * 
 * Routes user input requests from MCP servers to the correct VS Code instances
 * based on workspace identification, enabling multiple concurrent Claude Desktop
 * instances to work with different VS Code workspaces simultaneously.
 */

interface ClientInfo {
  ws: WebSocket;
  clientType: 'mcp-server' | 'vscode-extension';
  workspaceId: string;
  sessionId: string;
  connectedAt: Date;
}

interface WorkspaceMapping {
  mcpClient?: ClientInfo;
  vscodeClient?: ClientInfo;
}

interface RouterMessage {
  type: 'register' | 'request' | 'response' | 'heartbeat' | 'workspace-sync-request' | 'workspace-sync-response' | 'workspace-sync-complete' | 'manual-disconnection' | 'pairing-ready';
  clientType?: 'mcp-server' | 'vscode-extension';
  workspaceId?: string;
  sessionId?: string;
  requestId?: string;
  payload?: any;
  inputType?: string;
  options?: any;
  response?: any;
  // Workspace coordination fields
  vscodeWorkspace?: string;
  vscodeSessionId?: string;
  mcpWorkspace?: string;
  mcpSessionId?: string;
  accepted?: boolean;
  finalWorkspace?: string;
}

export class SharedRouter {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientInfo>();
  private workspaces = new Map<string, WorkspaceMapping>();
  private unmatchedMcpServers = new Map<string, ClientInfo>(); // sessionId -> ClientInfo
  private unmatchedVscodeClients = new Map<string, ClientInfo>(); // sessionId -> ClientInfo
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeout: NodeJS.Timeout | null;
    sourceWorkspace: string;
  }>();

  constructor(port: number = 8547) {
    // Create WebSocket server with proper error handling setup
    this.wss = new WebSocketServer({ port });

    // Set up error handling BEFORE the server starts listening
    this.setupServerErrorHandling();
    this.setupServer();

    // Handle successful listening
    this.wss.on('listening', () => {
      console.log(`[SharedRouter] WebSocket router listening on port ${port}`);
    });
  }

  private setupServerErrorHandling(): void {
    // Handle server-level errors with improved recovery
    this.wss.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[SharedRouter] Port is already in use. Another router instance may be running.`);
        console.error(`[SharedRouter] This is expected behavior when multiple VS Code instances are open.`);
        // Don't exit - let the extension handle this gracefully
        return;
      } else {
        console.error('[SharedRouter] Server error:', error);
        // Only exit on truly fatal errors, not port conflicts
        if (error.code !== 'EADDRINUSE') {
          process.exit(1);
        }
      }
    });
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[SharedRouter] New connection established');

      ws.on('message', (data: Buffer) => {
        try {
          const message: RouterMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('[SharedRouter] Error parsing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.handleDisconnection(ws);
      });

      ws.on('error', (error: Error) => {
        console.error('[SharedRouter] WebSocket error:', error);
        this.handleDisconnection(ws);
      });

      // Send initial connection acknowledgment
      this.sendMessage(ws, { type: 'heartbeat' });
    });

    // Clean up orphaned requests periodically
    setInterval(() => this.cleanupOrphanedRequests(), 60000); // Every minute
  }

  private handleMessage(ws: WebSocket, message: RouterMessage): void {
    switch (message.type) {
      case 'register':
        this.handleRegistration(ws, message);
        break;
      case 'request':
        this.handleRequest(ws, message);
        break;
      case 'response':
        this.handleResponse(ws, message);
        break;
      case 'workspace-sync-request':
        this.handleWorkspaceSyncRequest(ws, message);
        break;
      case 'workspace-sync-response':
        this.handleWorkspaceSyncResponse(ws, message);
        break;
      case 'heartbeat':
        this.sendMessage(ws, { type: 'heartbeat' });
        break;
      case 'manual-disconnection':
        this.handleManualDisconnection(ws, message);
        break;
      case 'pairing-ready':
        this.handlePairingReady(ws, message);
        break;
      default:
        console.warn('[SharedRouter] Unknown message type:', message.type);
    }
  }

  private handleManualDisconnection(ws: WebSocket, message: RouterMessage): void {
    const clientInfo = this.clients.get(ws);
    if (clientInfo) {
      console.log(`[SharedRouter] Manual disconnection signal received from ${clientInfo.clientType} for workspace: ${clientInfo.workspaceId}`);
      // The actual disconnection handling will be done by the ws.on('close') event
      // This is just for logging/acknowledgment
    }
  }

  private handlePairingReady(ws: WebSocket, message: RouterMessage): void {
    const clientInfo = this.clients.get(ws);
    if (clientInfo && clientInfo.clientType === 'vscode-extension') {
      console.log(`[SharedRouter] VS Code extension signals ready for pairing: ${clientInfo.sessionId} (workspace: ${clientInfo.workspaceId})`);
      // Force immediate coordination attempt when VS Code signals pairing readiness
      this.initiateWorkspaceCoordination(clientInfo);
    }
  }

  private handleRegistration(ws: WebSocket, message: RouterMessage): void {
    const { clientType, workspaceId } = message;

    if (!clientType || !workspaceId) {
      this.sendError(ws, 'Missing clientType or workspaceId in registration');
      return;
    }

    const normalizedWorkspaceId = normalizeWorkspacePath(workspaceId);
    const sessionId = message.sessionId || generateSessionId();

    // Remove any existing registration for this WebSocket
    this.handleDisconnection(ws);

    // Create client info
    const clientInfo: ClientInfo = {
      ws,
      clientType,
      workspaceId: normalizedWorkspaceId,
      sessionId,
      connectedAt: new Date()
    };

    // Register client
    this.clients.set(ws, clientInfo);

    // Add to unmatched clients for coordination
    if (clientType === 'mcp-server') {
      this.unmatchedMcpServers.set(sessionId, clientInfo);
      console.log(`[SharedRouter] Registered unmatched MCP server: ${sessionId} for workspace: ${normalizedWorkspaceId}`);
      
      // When MCP server connects, immediately try to coordinate with unmatched VS Code clients
      this.initiateWorkspaceCoordinationForMcp(clientInfo);
    } else if (clientType === 'vscode-extension') {
      this.unmatchedVscodeClients.set(sessionId, clientInfo);
      console.log(`[SharedRouter] Registered unmatched VS Code extension: ${sessionId} for workspace: ${normalizedWorkspaceId}`);
      
      // When VS Code connects, immediately try to coordinate with unmatched MCP servers
      this.initiateWorkspaceCoordination(clientInfo);
    }

    console.log(`[SharedRouter] Total clients: ${this.clients.size}, Unmatched MCP: ${this.unmatchedMcpServers.size}, Unmatched VSCode: ${this.unmatchedVscodeClients.size}`);

    // Send registration confirmation
    this.sendMessage(ws, {
      type: 'register',
      sessionId,
      workspaceId: normalizedWorkspaceId
    });
  }

  private handleRequest(ws: WebSocket, message: RouterMessage): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) {
      this.sendError(ws, 'Client not registered');
      return;
    }

    if (clientInfo.clientType !== 'mcp-server') {
      this.sendError(ws, 'Only MCP servers can send requests');
      return;
    }

    const workspace = this.workspaces.get(clientInfo.workspaceId);
    if (!workspace?.vscodeClient) {
      this.sendError(ws, 'No VS Code extension connected for this workspace');
      return;
    }

    const { requestId, inputType, options } = message;
    if (!requestId || !inputType || !options) {
      this.sendError(ws, 'Missing requestId, inputType, or options in request');
      return;
    }

    // Store pending request
    this.pendingRequests.set(requestId, {
      resolve: (response) => {
        this.sendMessage(ws, {
          type: 'response',
          requestId,
          response
        });
      },
      reject: (error) => {
        this.sendError(ws, `Request failed: ${error}`);
      },
      timeout: null, // No timeout - users can take their time
      sourceWorkspace: clientInfo.workspaceId
    });

    // Forward request to VS Code extension
    this.sendMessage(workspace.vscodeClient.ws, {
      type: 'request',
      requestId,
      inputType,
      options
    });

    console.log(`[SharedRouter] Forwarded ${inputType} request ${requestId} to VS Code for workspace: ${clientInfo.workspaceId}`);
  }

  private handleResponse(ws: WebSocket, message: RouterMessage): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) {
      this.sendError(ws, 'Client not registered');
      return;
    }

    if (clientInfo.clientType !== 'vscode-extension') {
      this.sendError(ws, 'Only VS Code extensions can send responses');
      return;
    }

    const { requestId, response } = message;
    if (!requestId) {
      this.sendError(ws, 'Missing requestId in response');
      return;
    }

    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      console.warn(`[SharedRouter] Received response for unknown request: ${requestId}`);
      return;
    }

    // Verify the response is from the correct workspace
    if (pendingRequest.sourceWorkspace !== clientInfo.workspaceId) {
      console.warn(`[SharedRouter] Response workspace mismatch for request ${requestId}`);
      return;
    }

    // Complete the request
    pendingRequest.resolve(response);
    this.pendingRequests.delete(requestId);

    console.log(`[SharedRouter] Completed request ${requestId} for workspace: ${clientInfo.workspaceId}`);
  }

  private handleDisconnection(ws: WebSocket): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) {
      return;
    }

    console.log(`[SharedRouter] ${clientInfo.clientType} disconnected from workspace: ${clientInfo.workspaceId}`);

    // Remove from clients map
    this.clients.delete(ws);

    // Remove from unmatched lists if present
    if (clientInfo.clientType === 'mcp-server') {
      this.unmatchedMcpServers.delete(clientInfo.sessionId);
    } else if (clientInfo.clientType === 'vscode-extension') {
      this.unmatchedVscodeClients.delete(clientInfo.sessionId);
    }

    // Update workspace mapping
    const workspace = this.workspaces.get(clientInfo.workspaceId);
    if (workspace) {
      const rePartnering = (partnerClient: ClientInfo, unmatchedList: Map<string, ClientInfo>) => {
        if (partnerClient) {
          unmatchedList.set(partnerClient.sessionId, partnerClient);
          console.log(`[SharedRouter] Moved ${partnerClient.clientType} ${partnerClient.sessionId} back to unmatched list for re-pairing.`);
        }
      };

      if (clientInfo.clientType === 'mcp-server') {
        rePartnering(workspace.vscodeClient!, this.unmatchedVscodeClients);
        delete workspace.mcpClient;
      } else if (clientInfo.clientType === 'vscode-extension') {
        rePartnering(workspace.mcpClient!, this.unmatchedMcpServers);
        delete workspace.vscodeClient;
      }

      // Clean up empty workspace mappings
      if (!workspace.mcpClient && !workspace.vscodeClient) {
        this.workspaces.delete(clientInfo.workspaceId);
        console.log(`[SharedRouter] Removed empty workspace: ${clientInfo.workspaceId}`);
      }
    }

    // Fail any pending requests from this workspace
    this.failPendingRequestsForWorkspace(clientInfo.workspaceId);

    console.log(`[SharedRouter] Active workspaces: ${this.workspaces.size}, Total clients: ${this.clients.size}`);
  }

  private sendMessage(ws: WebSocket, message: RouterMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'response',
      payload: { error }
    });
  }

  private failPendingRequestsForWorkspace(workspaceId: string): void {
    const toFail: string[] = [];
    
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      if (pendingRequest.sourceWorkspace === workspaceId) {
        toFail.push(requestId);
      }
    }

    toFail.forEach(requestId => {
      const pendingRequest = this.pendingRequests.get(requestId);
      if (pendingRequest) {
        pendingRequest.reject('VS Code extension disconnected');
        this.pendingRequests.delete(requestId);
      }
    });

    if (toFail.length > 0) {
      console.log(`[SharedRouter] Failed ${toFail.length} pending requests for workspace: ${workspaceId}`);
    }
  }

  private cleanupOrphanedRequests(): void {
    const now = Date.now();
    const orphanedRequests: string[] = [];

    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      // Check if the workspace still exists
      if (!this.workspaces.has(pendingRequest.sourceWorkspace)) {
        orphanedRequests.push(requestId);
      }
    }

    orphanedRequests.forEach(requestId => {
      const pendingRequest = this.pendingRequests.get(requestId);
      if (pendingRequest) {
        pendingRequest.reject('Workspace no longer available');
        this.pendingRequests.delete(requestId);
      }
    });

    if (orphanedRequests.length > 0) {
      console.log(`[SharedRouter] Cleaned up ${orphanedRequests.length} orphaned requests`);
    }
  }

  /**
   * Get router statistics for debugging
   */
  public getStats() {
    return {
      totalClients: this.clients.size,
      activeWorkspaces: this.workspaces.size,
      pendingRequests: this.pendingRequests.size,
      workspaces: Array.from(this.workspaces.entries()).map(([id, workspace]) => ({
        workspaceId: id,
        hasMcpClient: !!workspace.mcpClient,
        hasVscodeClient: !!workspace.vscodeClient
      }))
    };
  }

  /**
   * Gracefully shutdown the router
   */
  public async shutdown(): Promise<void> {
    console.log('[SharedRouter] Shutting down...');
    
    // Fail all pending requests
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      pendingRequest.reject('Router shutting down');
    }
    this.pendingRequests.clear();

    // Close all client connections
    for (const [ws] of this.clients.entries()) {
      ws.close();
    }

    // Close the server
    return new Promise((resolve) => {
      this.wss.close(() => {
        console.log('[SharedRouter] Shutdown complete');
        resolve();
      });
    });
  }

  /**
   * Initiate workspace coordination when VS Code extension connects
   */
  private initiateWorkspaceCoordination(vscodeClient: ClientInfo): void {
    console.log(`[SharedRouter] Initiating workspace coordination for VS Code: ${vscodeClient.sessionId}`);
    console.log(`[SharedRouter] VS Code workspace: ${vscodeClient.workspaceId}`);
    
    if (this.unmatchedMcpServers.size === 0) {
      console.log(`[SharedRouter] No unmatched MCP servers available for coordination`);
      return;
    }
    
    // Send workspace sync request to all unmatched MCP servers
    for (const [mcpSessionId, mcpClient] of this.unmatchedMcpServers) {
      console.log(`[SharedRouter] Sending workspace sync request to MCP server: ${mcpSessionId}`);
      console.log(`[SharedRouter] MCP workspace: ${mcpClient.workspaceId}`);
      
      try {
        this.sendMessage(mcpClient.ws, {
          type: 'workspace-sync-request',
          vscodeWorkspace: vscodeClient.workspaceId,
          vscodeSessionId: vscodeClient.sessionId,
          mcpWorkspace: mcpClient.workspaceId,
          mcpSessionId: mcpClient.sessionId
        });
      } catch (error) {
        console.error(`[SharedRouter] Failed to send workspace sync request to MCP ${mcpSessionId}:`, error);
      }
    }
  }

  /**
   * Initiate workspace coordination when MCP server connects
   */
  private initiateWorkspaceCoordinationForMcp(mcpClient: ClientInfo): void {
    console.log(`[SharedRouter] Initiating workspace coordination for MCP server: ${mcpClient.sessionId}`);
    console.log(`[SharedRouter] MCP workspace: ${mcpClient.workspaceId}`);
    
    if (this.unmatchedVscodeClients.size === 0) {
      console.log(`[SharedRouter] No unmatched VS Code clients available for coordination`);
      return;
    }
    
    // Send workspace sync request to the MCP server for each unmatched VS Code client
    for (const [vscodeSessionId, vscodeClient] of this.unmatchedVscodeClients) {
      console.log(`[SharedRouter] Sending workspace sync request to MCP server for VS Code: ${vscodeSessionId}`);
      console.log(`[SharedRouter] VS Code workspace: ${vscodeClient.workspaceId}`);
      
      try {
        this.sendMessage(mcpClient.ws, {
          type: 'workspace-sync-request',
          vscodeWorkspace: vscodeClient.workspaceId,
          vscodeSessionId: vscodeClient.sessionId,
          mcpWorkspace: mcpClient.workspaceId,
          mcpSessionId: mcpClient.sessionId
        });
      } catch (error) {
        console.error(`[SharedRouter] Failed to send workspace sync request to MCP ${mcpClient.sessionId}:`, error);
      }
    }
  }

  /**
   * Handle workspace sync request from VS Code extension
   */
  private handleWorkspaceSyncRequest(ws: WebSocket, message: any): void {
    console.log(`[SharedRouter] Handling workspace sync request from VS Code`);
    
    // This message is forwarded to MCP servers, not handled by router directly
    // The actual coordination logic is in initiateWorkspaceCoordination
  }

  /**
   * Handle workspace sync response from MCP server
   */
  private handleWorkspaceSyncResponse(ws: WebSocket, message: any): void {
    const { vscodeSessionId, mcpSessionId, accepted, finalWorkspace } = message;
    
    console.log(`[SharedRouter] Received workspace sync response: MCP ${mcpSessionId} ${accepted ? 'accepted' : 'rejected'} sync with VS Code ${vscodeSessionId}`);
    
    if (!accepted) {
      console.log(`[SharedRouter] Workspace sync rejected by MCP server ${mcpSessionId} - workspace mismatch`);
      return;
    }

    if (!finalWorkspace) {
      console.error(`[SharedRouter] Invalid workspace sync response - missing finalWorkspace`);
      return;
    }

    // Find the clients
    const mcpClient = this.unmatchedMcpServers.get(mcpSessionId);
    const vscodeClient = this.unmatchedVscodeClients.get(vscodeSessionId);

    if (!mcpClient || !vscodeClient) {
      console.warn(`[SharedRouter] Cannot complete sync - missing clients: MCP=${!!mcpClient}, VSCode=${!!vscodeClient}`);
      console.warn(`[SharedRouter] Available unmatched MCP servers: ${Array.from(this.unmatchedMcpServers.keys())}`);
      console.warn(`[SharedRouter] Available unmatched VS Code clients: ${Array.from(this.unmatchedVscodeClients.keys())}`);
      return;
    }

    try {
      // Create workspace mapping with final coordinated workspace
      const normalizedWorkspace = finalWorkspace;
      if (!this.workspaces.has(normalizedWorkspace)) {
        this.workspaces.set(normalizedWorkspace, {});
      }

      const workspace = this.workspaces.get(normalizedWorkspace)!;
      workspace.mcpClient = mcpClient;
      workspace.vscodeClient = vscodeClient;

      // Update client workspace IDs
      mcpClient.workspaceId = normalizedWorkspace;
      vscodeClient.workspaceId = normalizedWorkspace;

      // Remove from unmatched lists
      this.unmatchedMcpServers.delete(mcpSessionId);
      this.unmatchedVscodeClients.delete(vscodeSessionId);

      console.log(`[SharedRouter] ✅ Workspace coordination complete! Workspace: ${normalizedWorkspace}`);
      console.log(`[SharedRouter] 📊 Active workspaces: ${this.workspaces.size}, Unmatched MCP: ${this.unmatchedMcpServers.size}, Unmatched VSCode: ${this.unmatchedVscodeClients.size}`);

      // Notify both clients of successful coordination
      this.sendMessage(mcpClient.ws, {
        type: 'workspace-sync-complete',
        finalWorkspace: normalizedWorkspace,
        mcpSessionId,
        vscodeSessionId
      });

      this.sendMessage(vscodeClient.ws, {
        type: 'workspace-sync-complete',
        finalWorkspace: normalizedWorkspace,
        mcpSessionId,
        vscodeSessionId
      });
      
      console.log(`[SharedRouter] 📤 Coordination complete notifications sent to both clients`);
    } catch (error) {
      console.error(`[SharedRouter] ❌ Failed to complete workspace coordination:`, error);
    }
  }
}

// Start the router if this file is run directly
// More robust check for direct execution
const isMainModule = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1]) ||
  import.meta.url.includes(process.argv[1].replace(/\\/g, '/')) ||
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`
);

if (isMainModule) {
  console.log('[SharedRouter] Starting as main module');
  const port = parseInt(process.env.PORT || '8547', 10);
  
  try {
    const router = new SharedRouter(port);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[SharedRouter] Received SIGINT, shutting down gracefully...');
      await router.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[SharedRouter] Received SIGTERM, shutting down gracefully...');
      await router.shutdown();
      process.exit(0);
    });

    // Keep process alive - this was missing!
    process.on('uncaughtException', (error) => {
      console.error('[SharedRouter] Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[SharedRouter] Unhandled rejection:', reason);
      process.exit(1);
    });

    console.log('[SharedRouter] Process setup complete, staying alive...');
  } catch (error) {
    console.error('[SharedRouter] Failed to start:', error);
    process.exit(1);
  }
} else {
  console.log('[SharedRouter] Loaded as module');
}