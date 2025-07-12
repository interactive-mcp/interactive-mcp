import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket, { WebSocketServer } from "ws";
import { createHash } from "crypto";

// WebSocket server for VS Code extension communication
const wss = new WebSocketServer({ port: 8547 });
let vsCodeClient: WebSocket | null = null;

// Map to store pending requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout | null;
}>();

// Handle VS Code extension connections
wss.on("connection", (ws) => {
  console.log("VS Code extension connected");
  vsCodeClient = ws;

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
    console.log("VS Code extension disconnected");
    vsCodeClient = null;
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
  if (!vsCodeClient || vsCodeClient.readyState !== WebSocket.OPEN) {
    throw new Error("VS Code extension is not connected");
  }

  const requestId = createHash("md5")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex");

  return new Promise((resolve, reject) => {
    // No timeout - let users take their time to appreciate the beautiful UI!
    pendingRequests.set(requestId, { resolve, reject, timeout: null as any });

    vsCodeClient!.send(
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
  "Ask the user to choose from multiple options using buttons",
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
  "Ask the user for text input",
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
  "Ask the user for yes/no confirmation",
  {
    title: z.string().describe("Title of the confirmation dialog"),
    message: z.string().describe("Question to ask the user"),
  },
  async ({ title, message }) => {
    try {
      const response = await requestUserInput("confirm", {
        title,
        message,
      });
      return {
        content: [
          {
            type: "text",
            text: `User ${response.confirmed ? "confirmed" : "declined"}`,
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

// Tool: Show progress or completion notification
server.tool(
  "notify_user",
  "Show a notification to the user",
  {
    type: z.enum(["info", "warning", "error"]).describe("Type of notification"),
    message: z.string().describe("Message to display"),
  },
  async ({ type, message }) => {
    try {
      if (!vsCodeClient || vsCodeClient.readyState !== WebSocket.OPEN) {
        throw new Error("VS Code extension is not connected");
      }

      vsCodeClient.send(
        JSON.stringify({
          type: "notification",
          notificationType: type,
          message,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Notification sent: ${message}`,
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

// Tool: Show notification with button options
// server.tool(
//   "notify_user_with_buttons",
//   "Show a notification to the user with button options",
//   {
//     type: z.enum(["info", "warning", "error"]).describe("Type of notification"),
//     title: z.string().describe("Title of the notification"),
//     message: z.string().describe("Message to display"),
//     options: z.array(z.object({
//       label: z.string().describe("Button label"),
//       value: z.string().describe("Value returned when button is clicked"),
//     })).describe("Array of button options"),
//   },
//   async ({ type, title, message, options }) => {
//     try {
//       const response = await requestUserInput("notification_buttons", {
//         type,
//         title,
//         message,
//         options,
//       });
//       return {
//         content: [
//           {
//             type: "text",
//             text: `User selected: ${response.value}`,
//           },
//         ],
//       };
//     } catch (error) {
//       return {
//         content: [
//           {
//             type: "text",
//             text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
//           },
//         ],
//       };
//     }
//   }
// );

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Interactive MCP Server running on stdio");
  console.log("WebSocket server listening on port 8547 for VS Code extension");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 