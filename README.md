# Interactive MCP

Transform your AI conversations with seamless interactive prompts directly in VS Code. Never lose your flow when AI assistants like Claude need user input!

## 🚀 What This Project Does

When working with AI assistants, sometimes they need to ask you questions or get your input. Instead of interrupting your conversation, this system shows beautiful popups right in VS Code where you can respond seamlessly.

## 📦 Components

This repository contains two main components:

### 🎯 VS Code Extension (`interactive-vscode-extension/`)
A VS Code extension that displays interactive popups and connects to the MCP server.

**Compatible with:**
- VS Code
- Cursor
- Windsurf
- Other VS Code-based editors

### 🔧 MCP Server (`interactive-mcp-server/`)
A Model Context Protocol server that enables AI assistants to request user input through the extension.

## 🎬 How It Works

```
AI Assistant (Claude) → MCP Server → VS Code Extension → Interactive Popups
```

1. Install the VS Code extension
2. Configure your AI assistant to use the MCP server
3. Start chatting with your AI assistant
4. When input is needed, a popup appears in VS Code
5. Your response goes directly back to the AI conversation

## ✨ Features

- **🎨 Beautiful Interface**: Modern popups that match your editor theme
- **🔔 Smart Notifications**: Gentle audio chimes and visual cues
- **⚡ Zero Setup**: Works immediately after installation
- **🔒 Privacy First**: Everything runs locally on your machine
- **🎯 Multiple Input Types**:
  - Button selection (multiple choice)
  - Text input with custom responses
  - Yes/No confirmation dialogs

## 🚀 Quick Start

### For Users
1. Install the [Interactive MCP extension](https://marketplace.visualstudio.com/items?itemName=interactive-mcp.interactive-mcp) from VS Code Marketplace
2. Follow the setup instructions in the extension
3. Configure your AI assistant (Claude Desktop, etc.) with the provided MCP configuration

### For Developers
```bash
# Clone the repository
git clone https://github.com/interactive-mcp/interactive-mcp.git
cd interactive-mcp

# Set up the extension
cd interactive-vscode-extension
npm install
npm run compile

# Set up the server
cd ../interactive-mcp-server
npm install
npm run build
```

## 📁 Project Structure

```
interactive-mcp/
├── interactive-vscode-extension/    # VS Code extension
│   ├── src/                        # Extension source code
│   ├── package.json                # Extension manifest
│   └── README.md                   # Extension details page
├── interactive-mcp-server/          # MCP server
│   ├── src/                        # Server source code
│   └── package.json                # Server configuration
└── README.md                       # This file
```

## 🛠️ Development

### Extension Development
```bash
cd interactive-vscode-extension
npm run watch    # Watch mode for development
# Press F5 to launch Extension Development Host
```

### Server Development
```bash
cd interactive-mcp-server
npm run dev      # Development with tsx
npm run build    # Build for production
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/interactive-mcp/interactive-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/interactive-mcp/interactive-mcp/discussions)

---

**Made with ❤️ for seamless AI interactions** 