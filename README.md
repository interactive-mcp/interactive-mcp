# Interactive MCP

Transform your AI conversations with seamless interactive prompts directly in VS Code. Never lose your flow when AI assistants need user input!

![Example Interactive Popup](https://raw.githubusercontent.com/interactive-mcp/interactive-mcp/main/interactive-vscode-extension/assets/popup-example.png)

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
AI Assistant → MCP Server → VS Code Extension → Interactive Popups
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

## What's New in Version 0.3.2

- Fixed image display in VS Code Extensions Marketplace
- Improved README presentation with better visual examples
- Connection in multiple IDEs is now possible, enabling multi-instance and multi-workspace support

## 🚀 Quick Start

### For Users

#### 📦 **Step 1: Install the Extension**

1. Open VS Code, Cursor, Windsurf, or any VS Code-based editor
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for **"Interactive MCP"**
4. Click **Install**

#### ⚙️ **Step 2: Get MCP Configuration**

After installation, you need to get the configuration to add to your AI assistant's MCP setup:

**Option A: Welcome Notification (Recommended)**
- Look for a notification that says "Interactive MCP installed successfully!"
- Click **"Copy MCP JSON"** button in the notification
- ⚠️ **Note**: This notification only appears once after installation

**Option B: Command Palette (Always Available)**
- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
- Type: **"Interactive MCP: Copy MCP JSON Configuration"**
- Press Enter - the configuration is now copied to your clipboard

#### 🔧 **Step 3: Configure Your AI Assistant**

The configuration depends on which AI assistant you're using. Here's the general process:

1. **Find your AI assistant's MCP configuration file** (varies by assistant)

2. **Add the MCP server configuration:**
   
   **If this is your first MCP server:**
   ```json
   {
     "mcpServers": {
       // Paste your copied configuration here
     }
   }
   ```
   
   **If you already have other MCP servers:**
   ```json
   {
     "mcpServers": {
       "existing-server": {
         // your existing server config
       },
       // Paste your copied configuration here (it will add the "interactive-mcp" entry)
     }
   }
   ```

3. **Save the configuration file**

4. **Restart your IDE** completely

**Note on Updates:** If you update the extension, you may need to update the path in your MCP JSON config file. Use the command palette ("Interactive MCP: Copy MCP JSON Configuration") to get the latest configuration and update your file accordingly.

#### 🔌 **Step 4: Connect the Extension**

1. **Check the status bar** at the bottom of your editor
2. **Look for the "Interactive MCP" indicator:**
   - "🚫 **Interactive MCP Tools Off"** - Click it to connect
   - "✔️✔️ **Interactive MCP Tools Ready"** - You're ready to go!

#### Screenshots

![Interactive MCP status bar showing the ready state with connection indicator and chime button](https://raw.githubusercontent.com/interactive-mcp/interactive-mcp/main/interactive-vscode-extension/assets/extension-buttons.png)

**If auto-connection doesn't work:**
- Press `Ctrl+Shift+P` / `Cmd+Shift+P`
- Type: **"Interactive MCP: Connect to MCP Server"**
- Press Enter

#### ✅ **Step 5: Test It Works**

1. Open your AI assistant
2. Start a conversation
3. Ask something like: *"Can you ask me to choose between option A and option B?"*
4. You should see a popup appear in your VS Code editor!

#### 🆘 **Troubleshooting**

**Extension not connecting?**
- Make sure your AI assistant is running
- Check that you restarted your AI assistant after adding the config
- Verify the MCP configuration was pasted correctly (valid JSON)
- Try manually connecting via Command Palette

**No welcome notification appeared?**
- The notification only shows once after installation
- Use the Command Palette method: "Interactive MCP: Copy MCP JSON Configuration"

**Popup not appearing when AI asks questions?**
- Check the MCP status indicator shows "Connected"
- Make sure you're asking questions that require user input
- Try asking: "Please ask me to confirm something"
- You can add a Rule instructing the AI to always end their responses with a question and an interactive-mcp tool

**If the connection button hangs during Pairing?**
- Just toggle the MCP tool switch off and back on during pairing. That should make the connection succeed.

### For Developers

#### 🚀 **Automated Build (Recommended)**

We provide cross-platform build scripts that handle everything automatically:

**Windows:**
```bash
git clone https://github.com/interactive-mcp/interactive-mcp.git
cd interactive-mcp
build-extension.bat
```

**Linux/macOS:**
```bash
git clone https://github.com/interactive-mcp/interactive-mcp.git
cd interactive-mcp
chmod +x build-extension.sh
./build-extension.sh
```

**What the build scripts do:**
1. 🔧 Install all dependencies for both MCP server and VS Code extension
2. 📦 Build the MCP server TypeScript code
3. 🔗 Bundle the MCP server into the VS Code extension
4. ⚙️ Compile the VS Code extension TypeScript code
5. 📦 Package everything into a production-ready `.vsix` file
6. 📍 Show you exactly where the installable file is located

**After the build completes:**
- You'll get a `.vsix` file in the `interactive-vscode-extension/` directory
- Install it in VS Code via command palette: **Extensions: Install from VSIX...**
- The extension includes the bundled MCP server - no separate installation needed!

#### 🔧 **Manual Setup (For Advanced Users)**

If you prefer to run each step manually:

```bash
# 1. Set up the MCP server
cd interactive-mcp-server
npm install
npm run build

# 2. Set up the VS Code extension
cd ../interactive-vscode-extension
npm install
npm run bundle-server  # Copies the server into the extension
npm run compile        # Compiles the extension
npm run package        # Creates the .vsix file
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

## 🛠️ Development Workflow

### 🔄 **Live Development**

For active development with hot-reloading:

**Extension Development:**
```bash
cd interactive-vscode-extension
npm run watch    # Watches TypeScript files for changes
```
Then press `F5` in VS Code to launch Extension Development Host with your changes.

**Server Development:**
```bash
cd interactive-mcp-server
npm run dev      # Runs with tsx for hot-reloading
```

### 📦 **Build Scripts**

**`build-extension.bat`** (Windows) / **`build-extension.sh`** (Linux/macOS)
- Complete automated build process
- Handles all dependencies, compilation, bundling, and packaging
- Creates production-ready `.vsix` file
- Perfect for testing your changes or preparing for distribution

### 🧪 **Testing Your Changes**

1. Make your code changes
2. Run the appropriate build script for your OS
3. Install the generated `.vsix` file in VS Code
4. Test the extension with your AI assistant

### 📋 **Development Commands Reference**

**MCP Server:**
- `npm run dev` - Development with live reload
- `npm run build` - Production build
- `npm start` - Run the built server

**VS Code Extension:**
- `npm run watch` - Watch mode for development
- `npm run compile` - Compile TypeScript
- `npm run bundle-server` - Copy server into extension
- `npm run package` - Create .vsix file
- `npm run lint` - Run ESLint

## 🤝 Contributing

We welcome contributions! Here's how to get started:
1. **Fork the Repository**
   - Go to [https://github.com/interactive-mcp/interactive-mcp](https://github.com/interactive-mcp/interactive-mcp)
   - Click the "Fork" button in the top-right corner
   - This creates a copy of the repo in your GitHub account

2. **Clone Your Fork**
   ```bash
   git clone https://github.com/YOUR-USERNAME/interactive-mcp.git
   cd interactive-mcp
   ```
   *(Replace `YOUR-USERNAME` with your actual GitHub username)*

3. **Set Up Development Environment**
   ```bash
   # Use our build script for quick setup:
   # Windows: build-extension.bat
   # Linux/macOS: ./build-extension.sh
   ```

4. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-amazing-feature
   ```

5. **Make Your Changes**
   - Use `npm run watch` for live development
   - Follow existing code patterns and conventions
   - Test thoroughly with the generated `.vsix` file

6. **Push to Your Fork**
   ```bash
   git add .
   git commit -m 'Add amazing feature'
   git push origin feature/your-amazing-feature
   ```

7. **Create Pull Request**
   - Go to your fork on GitHub
   - Click "Compare & pull request" button
   - Fill out the PR description with details about your changes
   - Submit the Pull Request to the original repository

### 📝 **Contribution Guidelines**

- **Code Style**: Follow the existing TypeScript patterns
- **Testing**: Test your changes with real AI interactions
- **Documentation**: Update README if you add new features
- **Commits**: Write clear, descriptive commit messages

## 📄 License

This project is released into the **public domain** - completely free for everyone to use, modify, and distribute without any restrictions. See the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: Report bugs and request features via GitHub Issues

---

**Made with ❤️ for seamless AI interactions**