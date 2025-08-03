import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { createHash } from "crypto";
import * as path from "path";
import { normalizeWorkspacePath, areWorkspacePathsRelated } from "./path-utils.js";

// Shared router connection
let routerClient: WebSocket | undefined;
let isRouterReady = false;
let workspaceId = "";
let sessionId = "";

// Tool registration state
let toolsRegistered = false;

// Map to store pending requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout | null;
}>();

// Get workspace identifier from current working directory or environment
function getWorkspaceId(): string {
  console.error(`[MCP] 🚀 getWorkspaceId() called - PID: ${process.pid}`);

  // Check if there's a workspace hint in environment variables first
  const envWorkspace = process.env.VSCODE_WORKSPACE || process.env.MCP_WORKSPACE;
  if (envWorkspace) {
    console.error(`[MCP] 🔍 Using workspace from environment: ${envWorkspace}`);
    return path.resolve(envWorkspace);
  }

  // Use CWD as workspace identifier (this will be the directory where Claude Desktop starts the MCP server)
  const cwd = process.cwd();
  console.error(`[MCP] 🔍 Using workspace from CWD: ${cwd}`);

  // Always try to find the interactive-mcp workspace for better coordination
  const userHome = require('os').homedir();
  const possibleWorkspaces = [
    path.join(userHome, 'Desktop', 'interactive-mcp'),
    path.join(userHome, 'Documents', 'interactive-mcp'),
    path.join(userHome, 'interactive-mcp')
  ];

  for (const workspace of possibleWorkspaces) {
    if (require('fs').existsSync(workspace)) {
      console.error(`[MCP] ✅ Found interactive-mcp workspace: ${workspace}`);
      console.error(`[MCP] 🔄 Switching from CWD (${cwd}) to workspace (${workspace})`);
      return path.resolve(workspace);
    }
  }

  // If CWD looks like a VS Code installation path, warn about it
  if (cwd.includes('Microsoft VS Code') || cwd.includes('VSCode')) {
    console.error(`[MCP] ⚠️ Warning: CWD appears to be VS Code installation path, not a workspace`);
    console.error(`[MCP] ⚠️ This indicates the MCP server was started by an AI assistant, not VS Code extension`);
    console.error(`[MCP] ⚠️ Could not find interactive-mcp workspace, using CWD as fallback`);
  }

  // Fallback to current working directory
  return path.resolve(cwd);
}

// Connect to shared router (simple, no retry logic)
function connectToRouter(): Promise<void> {
  return new Promise((resolve, reject) => {
    const routerPort = parseInt(process.env.MCP_ROUTER_PORT || '8547', 10);
    const routerHost = process.env.MCP_ROUTER_HOST || 'localhost';
    
    console.error(`[MCP] 🔌 Attempting to connect to router at ws://${routerHost}:${routerPort}`);
    
    routerClient = new WebSocket(`ws://${routerHost}:${routerPort}`);
    
    routerClient.on('open', () => {
      console.error('[MCP] 🔗 WebSocket connection established with router');
      
      // Register with router
      workspaceId = getWorkspaceId();
      sessionId = `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      
      console.error(`[MCP] 📝 Registering with router - Workspace: ${workspaceId}, Session: ${sessionId}`);
      
      routerClient!.send(JSON.stringify({
        type: 'register',
        clientType: 'mcp-server',
        workspaceId,
        sessionId
      }));
      
      isRouterReady = true;
      
      // FIXED: Register tools immediately after router connection
      // This ensures tools show as "3 tools enabled" when router is connected
      // Workspace coordination is still needed for actual tool functionality
      console.error('[MCP] 🔧 Registering tools immediately after router connection');
      registerTools();
      
      resolve();
    });
    
    routerClient.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'register') {
          console.error('[MCP] ✅ Registration confirmed by router');
        } else if (message.type === 'response' && message.requestId) {
          const pending = pendingRequests.get(message.requestId);
          if (pending) {
            pending.resolve(message.response);
            pendingRequests.delete(message.requestId);
          }
        } else if (message.type === 'workspace-sync-request') {
          handleWorkspaceSyncRequest(message);
        } else if (message.type === 'workspace-sync-complete') {
          handleWorkspaceSyncComplete(message);
        } else if (message.type === 'pairing-ready') {
          const isReconnection = message.isReconnection || false;
          console.error(`[MCP] 📢 VS Code extension is pairing-ready ${isReconnection ? '(RECONNECTION)' : '(INITIAL)'} - triggering tool refresh for IDE`);
          
          if (isReconnection) {
            // More aggressive refresh for manual reconnections
            console.error('[MCP] 🔄 Applying aggressive reconnection refresh sequence');
            
            // Multiple refresh cycles for reconnections
            forceToolRefresh();
            setTimeout(() => forceToolRefresh(), 500);
            setTimeout(() => forceToolRefresh(), 1000);
            setTimeout(() => forceToolRefresh(), 1500);
          } else {
            // Standard refresh for initial connections
            forceToolRefresh();
          }
        } else if (message.type === 'auto-retry-trigger') {
          console.error(`[MCP] 🔄 Auto-retry triggered: ${message.reason}`);
          // Force tool re-registration to help IDE detect availability
          setTimeout(() => {
            if (routerClient && routerClient.readyState === WebSocket.OPEN) {
              console.error('[MCP] 🔧 Re-registering tools to help IDE detection');
              registerTools();
            }
          }, 500);
        } else if (message.type === 'manual-disconnection') {
          console.error('[MCP] 🔌 Manual disconnection detected - clearing tool state for clean reconnection');
          
          // Reset tool registration state to ensure clean reconnection
          toolsRegistered = false;
          
          // Clear any ongoing heartbeat
          if (autoDetectionInterval) {
            clearInterval(autoDetectionInterval);
            autoDetectionInterval = null;
          }
          
          console.error('[MCP] 🧹 Tool state cleared - ready for clean reconnection');
        }
      } catch (error) {
        // Silently ignore parsing errors to avoid corrupting MCP stdio
      }
    });
    
    routerClient.on('close', () => {
      console.error('[MCP] 🔌 Router connection closed');
      isRouterReady = false;
      routerClient = undefined;
      
      // Attempt to reconnect after a brief delay
      // This handles cases where the extension manually disconnects and restarts the router
      setTimeout(() => {
        if (!isRouterReady) {
          console.error('[MCP] 🔄 Attempting to reconnect to router...');
          connectToRouter().catch((error) => {
            console.error('[MCP] ❌ Failed to reconnect to router:', error.message);
          });
        }
      }, 1000);
    });
    
    routerClient.on('error', (error) => {
      console.error('[MCP] ❌ Router connection error:', error.message);
      isRouterReady = false;
      routerClient = undefined;
      reject(error);
    });
    
    // Simple timeout for connection
    setTimeout(() => {
      if (!isRouterReady) {
        console.error('[MCP] ⏰ Router connection timed out after 5 seconds');
        routerClient?.close();
        reject(new Error('Router connection timeout'));
      }
    }, 5000);
  });
}

// Create MCP server instance
const server = new McpServer({
  name: "interactive-mcp",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Handle workspace sync request from router
function handleWorkspaceSyncRequest(message: any): void {
  const { vscodeWorkspace, vscodeSessionId, mcpWorkspace, mcpSessionId } = message;
  
  if (!vscodeWorkspace || !vscodeSessionId || !mcpWorkspace || !mcpSessionId) {
    console.error(`[MCP] ❌ Invalid workspace sync request - missing required fields`);
    return;
  }
  
  console.error(`[MCP] 🔄 Workspace sync request received:`);
  console.error(`[MCP]    VS Code workspace: ${vscodeWorkspace}`);
  console.error(`[MCP]    MCP workspace: ${mcpWorkspace}`);
  console.error(`[MCP]    VS Code session: ${vscodeSessionId}`);
  console.error(`[MCP]    MCP session: ${mcpSessionId}`);
  
  try {
    // Simple workspace matching logic - normalize paths and check if they're compatible
    const normalizedVscodeWorkspace = normalizeWorkspacePath(vscodeWorkspace);
    const normalizedMcpWorkspace = normalizeWorkspacePath(mcpWorkspace);
    
    console.error(`[MCP] 🔍 Normalized paths:`);
    console.error(`[MCP]    VS Code: ${normalizedVscodeWorkspace}`);
    console.error(`[MCP]    MCP: ${normalizedMcpWorkspace}`);
    
    // Check if workspaces are related (exact match or parent-child relationship)
    const isWorkspaceMatch = areWorkspacePathsRelated(normalizedVscodeWorkspace, normalizedMcpWorkspace);
    
    console.error(`[MCP] 🎯 Workspace match result: ${isWorkspaceMatch}`);
    
    if (isWorkspaceMatch) {
      // Accept the sync and use the VS Code workspace as the final workspace
      const finalWorkspace = normalizedVscodeWorkspace;
      
      console.error(`[MCP] ✅ Accepting workspace sync - Final workspace: ${finalWorkspace}`);
      
      // Update our workspace ID to match
      workspaceId = finalWorkspace;
      
      // Send acceptance response
      if (routerClient && routerClient.readyState === 1) { // WebSocket.OPEN = 1
        routerClient.send(JSON.stringify({
          type: 'workspace-sync-response',
          vscodeSessionId,
          mcpSessionId,
          accepted: true,
          finalWorkspace
        }));
        console.error(`[MCP] 📤 Acceptance response sent to router`);
      } else {
        console.error(`[MCP] ❌ Cannot send response - router connection not available`);
      }
    } else {
      console.error(`[MCP] ❌ Rejecting workspace sync - Workspaces don't match`);
      
      // Send rejection response
      if (routerClient && routerClient.readyState === 1) { // WebSocket.OPEN = 1
        routerClient.send(JSON.stringify({
          type: 'workspace-sync-response',
          vscodeSessionId,
          mcpSessionId,
          accepted: false
        }));
        console.error(`[MCP] 📤 Rejection response sent to router`);
      } else {
        console.error(`[MCP] ❌ Cannot send response - router connection not available`);
      }
    }
  } catch (error) {
    console.error(`[MCP] ❌ Error handling workspace sync request:`, error);
    
    // Send rejection response on error
    if (routerClient && routerClient.readyState === 1) {
      routerClient.send(JSON.stringify({
        type: 'workspace-sync-response',
        vscodeSessionId,
        mcpSessionId,
        accepted: false
      }));
    }
  }
}

// Handle workspace sync completion notification
function handleWorkspaceSyncComplete(message: any): void {
  const { finalWorkspace, mcpSessionId, vscodeSessionId } = message;
  
  console.error(`[MCP] 🎉 Workspace coordination complete! Final workspace: ${finalWorkspace}`);
  console.error(`[MCP] 🔗 Now paired with VS Code session: ${vscodeSessionId}`);
  console.error(`[MCP] 📊 Coordination summary: MCP=${mcpSessionId}, VSCode=${vscodeSessionId}`);
  
  // Update our workspace ID if needed
  workspaceId = finalWorkspace;
  
  // Tools are already registered after router connection, but ensure they're registered
  console.error(`[MCP] 🔧 Ensuring tools are registered after workspace coordination...`);
  registerTools();
  
  console.error(`[MCP] ✅ MCP server fully operational - tools registered and workspace coordinated`);
}

// Helper function to send request to VS Code via shared router
async function requestUserInput(
  type: "buttons" | "text" | "confirm",
  options: any
): Promise<any> {
  if (!isRouterReady || !routerClient || routerClient.readyState !== WebSocket.OPEN) {
    throw new Error("Interactive MCP extension not connected. Please ensure VS Code extension is installed and router is running.");
  }

  const requestId = createHash("md5")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex");

  return new Promise((resolve, reject) => {
    // No timeout - let users take their time to appreciate the beautiful UI!
    pendingRequests.set(requestId, { resolve, reject, timeout: null as any });

    // Send request through shared router
    routerClient!.send(
      JSON.stringify({
        type: "request",
        requestId,
        inputType: type,
        options,
      })
    );
  });
}

// Auto-detection heartbeat to help IDE detect tools during pairing
let autoDetectionInterval: NodeJS.Timeout | null = null;

// Force tool refresh to help IDE detect tools during pairing
function forceToolRefresh(): void {
  console.error('[MCP] 🔄 Starting forced tool refresh sequence for IDE detection');
  
  // Strategy: Reset toolsRegistered flag and re-register tools
  // This simulates what happens when user toggles MCP tools off/on
  setTimeout(() => {
    console.error('[MCP] 🧹 Step 1: Clearing tool registration state');
    toolsRegistered = false;
    
    // Brief pause, then re-register
    setTimeout(() => {
      console.error('[MCP] 🔧 Step 2: Re-registering tools to trigger IDE refresh');
      registerTools();
      
      // Send additional notification
      if (routerClient && routerClient.readyState === WebSocket.OPEN) {
        const refreshCompleteMessage = {
          type: 'tool-refresh-complete',
          workspaceId,
          sessionId,
          timestamp: Date.now()
        };
        
        try {
          routerClient.send(JSON.stringify(refreshCompleteMessage));
          console.error('[MCP] ✅ Tool refresh complete - IDE should detect tools now');
        } catch (error) {
          console.error('[MCP] ❌ Failed to send refresh complete message');
        }
      }
    }, 100);
  }, 100);
}

function startAutoDetectionHeartbeat(): void {
  // Clear any existing interval
  if (autoDetectionInterval) {
    clearInterval(autoDetectionInterval);
  }
  
  let heartbeatCount = 0;
  
  // Send periodic signals to help IDE detect tools during pairing
  autoDetectionInterval = setInterval(() => {
    if (routerClient && routerClient.readyState === WebSocket.OPEN && !isRouterReady) {
      heartbeatCount++;
      
      // Only send during pairing (when router connected but not ready)
      const heartbeatMessage = {
        type: 'tools-available-heartbeat',
        workspaceId,
        sessionId,
        timestamp: Date.now(),
        count: heartbeatCount
      };
      
      try {
        routerClient.send(JSON.stringify(heartbeatMessage));
        console.error(`[MCP] 💓 Sent tools-available heartbeat during pairing (${heartbeatCount})`);
        
        // Trigger additional tool refresh every 3rd heartbeat for more aggressive detection
        if (heartbeatCount % 3 === 0) {
          console.error('[MCP] 🔄 Triggering additional tool refresh via heartbeat');
          setTimeout(() => forceToolRefresh(), 200);
        }
      } catch (error) {
        // Ignore send errors during heartbeat
      }
    } else if (isRouterReady && autoDetectionInterval) {
      // Stop heartbeat once pairing is complete
      clearInterval(autoDetectionInterval);
      autoDetectionInterval = null;
      console.error('[MCP] ✅ Pairing complete - stopping auto-detection heartbeat');
    }
  }, 2000); // Send every 2 seconds during pairing
  
  console.error('[MCP] 💓 Started aggressive auto-detection heartbeat for IDE pairing');
}

// Tool registration - can be called multiple times safely
function registerTools(): void {
  if (toolsRegistered) {
    console.error('[MCP] ✅ Tools already registered, skipping duplicate registration');
    return;
  }
  
  console.error('[MCP] 🔧 Registering tools after router connection');
  
  // Start auto-detection heartbeat to help IDE during pairing
  startAutoDetectionHeartbeat();
  
  // Tool: Ask user with buttons
  server.tool(
    "ask_user_buttons",
    "Ask the user to choose from multiple predefined options using buttons. BEST FOR: Multiple choice questions, menu selections, preference choices. Each option should be distinct and clear. Users can also provide custom text if none of the buttons fit their needs. The message supports Markdown formatting (headers, **bold**, *italic*, lists, `code`, code blocks, links).",
    {
      title: z.string().describe("Title of the popup"),
      message: z.string().describe("Message to display to the user (supports Markdown formatting)"),
      options: z.array(z.object({
        label: z.string().describe("Button label"),
        value: z.string().describe("Value returned when button is clicked"),
      })).describe("Array of button options"),
    },
    async ({ title, message, options }) => {
      try {
        const response = await requestUserInput("buttons", {
          title,
          message,
          options,
        });
        return {
          content: [
            {
              type: "text",
              text: `User selected: ${response.value}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Ask user for text input
  server.tool(
    "ask_user_text",
    "Ask the user for free-form text input. BEST FOR: Open-ended questions, detailed explanations, custom input where you need the user to type their own response. Always provide a clear, specific prompt. The prompt supports Markdown formatting (headers, **bold**, *italic*, lists, `code`, code blocks, links).",
    {
      title: z.string().describe("Title of the input box"),
      prompt: z.string().describe("Prompt message for the user (supports Markdown formatting)"),
      placeholder: z.string().optional().describe("Placeholder text for the input field"),
      defaultValue: z.string().optional().describe("Default value for the input field"),
    },
    async ({ title, prompt, placeholder, defaultValue }) => {
      try {
        const response = await requestUserInput("text", {
          title,
          prompt,
          placeholder,
          defaultValue,
        });
        return {
          content: [
            {
              type: "text",
              text: `User entered: ${response.value || "(empty)"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Ask user for confirmation
  server.tool(
    "ask_user_confirm",
    "Ask the user for a single binary decision with positive/negative outcome. ONLY USE FOR: Single actions that can be confirmed or declined (e.g., 'Save changes?', 'Delete file?', 'Proceed with action?'). DO NOT USE for choosing between two different options - use ask_user_buttons instead. Users can also provide custom text to explain their choice. The message supports Markdown formatting (headers, **bold**, *italic*, lists, `code`, code blocks, links).",
    {
      title: z.string().describe("Title of the confirmation dialog"),
      message: z.string().describe("Single question about one action that user can confirm or decline (supports Markdown formatting)"),
      confirmText: z.string().optional().describe("Text for the positive/confirm button (default: 'Yes')"),
      cancelText: z.string().optional().describe("Text for the negative/cancel button (default: 'No')"),
    },
    async ({ title, message, confirmText, cancelText }) => {
      try {
        const response = await requestUserInput("confirm", {
          title,
          message,
          confirmText: confirmText || "Yes",
          cancelText: cancelText || "No",
        });
        // Handle both boolean confirmation and custom text responses
        if (response.value) {
          return {
            content: [
              {
                type: "text",
                text: `User provided custom response: ${response.value}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `User ${response.confirmed ? "confirmed" : "declined"}`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
  );
  
  toolsRegistered = true;
  console.error('[MCP] ✅ All tools registered successfully');
}


// Start the server
async function main() {
  console.error('[MCP] 🚀 Starting Interactive MCP server...');
  console.error(`[MCP] 📊 Environment - Router port: ${process.env.MCP_ROUTER_PORT || '8547'}, Host: ${process.env.MCP_ROUTER_HOST || 'localhost'}`);

  const transport = new StdioServerTransport();

  // Connect to shared router
  try {
    await connectToRouter();
    // Use stderr for logging to avoid corrupting MCP stdio (stdout)
    console.error('[MCP] ✅ Successfully connected to shared router');
  } catch (error) {
    console.error('[MCP] ⚠️ Failed to connect to shared router:', error instanceof Error ? error.message : error);
    console.error('[MCP] 🔄 Will continue without router - VS Code extension may not be running');
  }

  // Connect MCP stdio transport
  await server.connect(transport);
  console.error('[MCP] 🚀 MCP server ready on stdio transport');
  console.error('[MCP] 📡 Waiting for client connections...');
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 