# Interactive MCP Server

This MCP (Model Context Protocol) server enables AI assistants to interactively request user input through VS Code popups without interrupting the conversation flow.

## Features

The server provides the following tools:

1. **ask_user_buttons** - Show a popup with multiple button options
2. **ask_user_text** - Request text input from the user
3. **ask_user_confirm** - Ask for yes/no confirmation
4. **notify_user** - Display notifications (info, warning, error)

- Supports multiple instances with workspace coordination via shared router

## How it Works

1. The MCP server runs as a stdio server that can be connected to by AI assistants
2. It connects to the shared router (typically on port 8547) for communication with VS Code extensions
3. When the AI uses one of the tools, the server sends a request through the router to the appropriate VS Code extension
4. The extension shows the appropriate popup and sends the user's response back through the router
5. The AI receives the response and continues the conversation

## Installation

```bash
npm install
npm run build
```