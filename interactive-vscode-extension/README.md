# Interactive MCP

Transform your AI conversations with seamless interactive prompts directly in VS Code, Cursor, Windsurf, and other VS Code-based editors. Never lose your flow when Claude needs user input!

## ✨ What This Extension Does

When working with AI assistants like Claude, sometimes they need to ask you questions or get your input. Instead of interrupting your conversation, this extension shows beautiful popups right in your editor where you can:

- Choose from multiple options with buttons
- Type custom responses
- Confirm or decline actions

All responses go directly back to your AI conversation seamlessly.

## 🎯 Key Features

- **🎨 Beautiful Interface**: Modern popups that match your editor theme
- **🔔 Smart Notifications**: Gentle audio chimes and visual cues so you never miss a prompt
- **⚡ Zero Setup**: Works immediately after installation - no complex configuration needed
- **🔒 Privacy First**: Everything runs locally on your machine
- **📊 Connection Status**: Always know if your extension is ready in the status bar

## 🎬 How It Works

1. Install this extension in your VS Code-based editor
2. Copy the provided configuration to Claude Desktop
3. Start chatting with Claude
4. When Claude needs input, a popup appears in your editor
5. Your response goes directly back to Claude

**Compatible with:**
- VS Code
- Cursor  
- Windsurf
- Other VS Code-based editors

## 🚀 Quick Setup

### Step 1: Install the Extension

1. Open your VS Code-based editor (VS Code, Cursor, Windsurf, etc.)
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Interactive MCP"
4. Click Install

### Step 2: Get Your Configuration

After installation, click "Copy MCP JSON Configuration" from the welcome notification or use the command palette (Ctrl+Shift+P) to find "Interactive MCP: Copy MCP JSON Configuration".

### Step 3: Configure Claude Desktop

1. Open your Claude Desktop configuration file:
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add the copied configuration to the `mcpServers` section:
   ```json
   {
     "mcpServers": {
       "interactive-mcp": {
         // Paste your copied configuration here
       }
     }
   }
   ```

3. Restart Claude Desktop

### Step 4: Start Using

That's it! When Claude needs your input, you'll see popups in VS Code automatically.

## 🎯 How to Use

Once set up, the extension works automatically:

- **Status Bar**: Check the "MCP" indicator in your editor's status bar to see connection status
- **Auto-Connect**: The extension connects automatically when your editor starts
- **Manual Control**: Click the status bar indicator or use the Command Palette (Ctrl+Shift+P) to find "Interactive MCP" commands

### Status Indicators
- 🔌 **MCP Disconnected** - Click to connect
- ✅ **MCP Connected** - Ready to receive prompts from Claude

## ⚙️ Settings

Customize the extension via: **File > Preferences > Settings > Extensions > Interactive MCP**

- **Auto Connect**: Automatically connect when your editor starts (recommended: ✅ enabled)
- **Auto Start Server**: Automatically start the local server if needed (recommended: ✅ enabled)  
- **Chime Sound**: Enable audio notifications for new prompts (recommended: ✅ enabled)
- **Server Port**: Advanced users can change the connection port (default: 8547)

## 🆘 Troubleshooting

**Extension not connecting?**
- Check that Claude Desktop is running
- Verify the configuration was added correctly to `claude_desktop_config.json`
- Try restarting both your editor and Claude Desktop

**No popups appearing?**
- Look for the "MCP Connected" status in your editor's status bar
- Make sure you're asking Claude questions that require user input
- Check that popup notifications aren't being blocked by your system

**Need help?**
- Use the Command Palette (Ctrl+Shift+P) and search for "Interactive MCP" commands
- Check the extension's output panel in your editor for error messages

## 📄 License

MIT License - Free to use and modify.

---

**Made with ❤️ for seamless AI interactions in VS Code-based editors** 