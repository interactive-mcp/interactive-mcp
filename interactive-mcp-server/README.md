# Interactive MCP Server

This MCP (Model Context Protocol) server enables AI assistants to interactively request user input through VS Code popups without interrupting the conversation flow.

## Features

The server provides the following tools:

1. **ask_user_buttons** - Show a popup with multiple button options
2. **ask_user_text** - Request text input from the user
3. **ask_user_confirm** - Ask for yes/no confirmation
4. **notify_user** - Display notifications (info, warning, error)

## How it Works

1. The MCP server runs as a stdio server that can be connected to by AI assistants
2. It also runs a WebSocket server on port 8547 for communication with the VS Code extension
3. When the AI uses one of the tools, the server sends a request to the VS Code extension
4. The extension shows the appropriate popup and sends the user's response back
5. The AI receives the response and continues the conversation

## Installation

```bash
npm install
npm run build
```

## Running the Server

For development:
```bash
npm run dev
```

For production:
```bash
npm run build
npm start
```

## Configuration for AI Assistants

Add this server to your MCP configuration (e.g., for Claude Desktop):

```json
{
  "mcpServers": {
    "interactive": {
      "command": "node",
      "args": ["/path/to/interactive-mcp-server/dist/index.js"]
    }
  }
}
```

## VS Code Extension

This server requires the companion VS Code extension to be installed and running. The extension will automatically connect to the WebSocket server when activated.

## Example Usage

Once connected, the AI assistant can use commands like:

- "Let me ask you which option you prefer" (uses ask_user_buttons)
- "I need some input from you" (uses ask_user_text)
- "Should I proceed with this change?" (uses ask_user_confirm)
- "Operation completed successfully" (uses notify_user) 