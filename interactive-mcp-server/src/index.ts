import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket, { WebSocketServer } from "ws";
import { createHash } from "crypto";

// WebSocket server for VS Code extension communication
const wss = new WebSocketServer({ port: 8547 });
const vsCodeClients = new Set<WebSocket>();
let isWebSocketReady = false;

// Map to store pending requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout | null;
}>();

// Handle VS Code extension connections
wss.on("connection", (ws) => {
  console.log(`VS Code extension connected (${vsCodeClients.size + 1} total)`);
  vsCodeClients.add(ws);
  isWebSocketReady = true;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === "response" && message.requestId) {
        const pending = pendingRequests.get(message.requestId);
        if (pending) {
          // No timeout to clear anymore - users can take their time!
          pending.resolve(message.response);
          pendingRequests.delete(message.requestId);
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    vsCodeClients.delete(ws);
    console.log(`VS Code extension disconnected (${vsCodeClients.size} remaining)`);
    if (vsCodeClients.size === 0) {
      isWebSocketReady = false;
    }
  });
});

// Create MCP server instance
const server = new McpServer({
  name: "interactive-mcp",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Helper function to send request to VS Code and wait for response
async function requestUserInput(
  type: "buttons" | "text" | "confirm",
  options: any
): Promise<any> {
  if (!isWebSocketReady || vsCodeClients.size === 0) {
    throw new Error("VS Code extension is not connected");
  }

  const requestId = createHash("md5")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex");

  return new Promise((resolve, reject) => {
    // No timeout - let users take their time to appreciate the beautiful UI!
    pendingRequests.set(requestId, { resolve, reject, timeout: null as any });

    // Send to the first available client (you could enhance this to show UI in all instances)
    const firstClient = Array.from(vsCodeClients).find(client => client.readyState === WebSocket.OPEN);
    
    if (!firstClient) {
      reject(new Error("No active VS Code connections available"));
      return;
    }

    firstClient.send(
      JSON.stringify({
        type: "request",
        requestId,
        inputType: type,
        options,
      })
    );
  });
}



// Tool: Ask user with buttons
server.tool(
  "ask_user_buttons",
  "Ask the user to choose from multiple predefined options using buttons. BEST FOR: Multiple choice questions, menu selections, preference choices. Each option should be distinct and clear. Users can also provide custom text if none of the buttons fit their needs.",
  {
    title: z.string().describe("Title of the popup"),
    message: z.string().describe("Message to display to the user"),
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
  "Ask the user for free-form text input. BEST FOR: Open-ended questions, detailed explanations, custom input where you need the user to type their own response. Always provide a clear, specific prompt.",
  {
    title: z.string().describe("Title of the input box"),
    prompt: z.string().describe("Prompt message for the user"),
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
  "Ask the user for a single binary decision with positive/negative outcome. ONLY USE FOR: Single actions that can be confirmed or declined (e.g., 'Save changes?', 'Delete file?', 'Proceed with action?'). DO NOT USE for choosing between two different options - use ask_user_buttons instead. Users can also provide custom text to explain their choice.",
  {
    title: z.string().describe("Title of the confirmation dialog"),
    message: z.string().describe("Single question about one action that user can confirm or decline"),
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


// Start the server
async function main() {
  const transport = new StdioServerTransport();
  
  // Start WebSocket server but don't announce readiness yet
  console.log("WebSocket server listening on port 8547 for VS Code extension");
  
  // Wait for VS Code extension to connect before announcing MCP readiness
  console.log("Waiting for VS Code extension connection...");
  
  // Connect to MCP transport only after WebSocket is ready
  await new Promise<void>((resolve) => {
    const checkWebSocket = () => {
      if (isWebSocketReady) {
        resolve();
      } else {
        setTimeout(checkWebSocket, 100);
      }
    };
    checkWebSocket();
  });
  
  await server.connect(transport);
  console.log("Interactive MCP Server ready - VS Code extension connected and MCP stdio active");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 