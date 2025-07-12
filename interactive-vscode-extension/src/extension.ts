import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

let wsClient: WebSocket | undefined;
let statusBarItem: vscode.StatusBarItem;
let mcpServerProcess: ChildProcess | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Interactive MCP Helper is now active!');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(plug) MCP Disconnected";
    statusBarItem.tooltip = "Click to connect to MCP server";
    statusBarItem.command = 'interactiveMcp.connect';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.connect', () => {
            connectToMcpServer(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.disconnect', () => {
            disconnectFromMcpServer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.startServer', () => {
            startLocalMcpServer(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.stopServer', () => {
            stopLocalMcpServer();
        })
    );

    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    if (config.get<boolean>('autoConnect')) {
        connectToMcpServer(context);
    }
}

async function startLocalMcpServer(context: vscode.ExtensionContext): Promise<boolean> {
    if (mcpServerProcess) {
        console.log('MCP server already running');
        return true;
    }

    try {
        const config = vscode.workspace.getConfiguration('interactiveMcp');
        const useNpx = config.get<boolean>('useNpx');
        const serverPackage = config.get<string>('serverPackage') || 'interactive-mcp-server';
        
        let command: string;
        let args: string[];
        
        if (useNpx) {
            // Use npx to run the server (no global installation required)
            command = 'npx';
            args = [serverPackage];
            console.log('Starting MCP server with npx:', serverPackage);
        } else {
            // Try bundled server or custom path
            const serverPath = getServerPath(context);
            
            if (!serverPath) {
                vscode.window.showErrorMessage('MCP server not found. Enable "Use npx" setting or install the server.');
                return false;
            }

            command = 'node';
            args = [serverPath];
            console.log('Starting MCP server at:', serverPath);
        }
        
        mcpServerProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'production' },
            shell: true // Enable shell for npx on Windows
        });

        mcpServerProcess.stdout?.on('data', (data) => {
            console.log('MCP Server:', data.toString());
        });

        mcpServerProcess.stderr?.on('data', (data) => {
            console.error('MCP Server Error:', data.toString());
        });

        mcpServerProcess.on('close', (code) => {
            console.log(`MCP server exited with code ${code}`);
            mcpServerProcess = undefined;
        });

        mcpServerProcess.on('error', (error) => {
            console.error('Failed to start MCP server:', error);
            mcpServerProcess = undefined;
            
            if (useNpx && error.message.includes('ENOENT')) {
                vscode.window.showErrorMessage(
                    'npx not found. Please install Node.js or disable "Use npx" setting.',
                    'Install Node.js', 'Open Settings'
                ).then(action => {
                    if (action === 'Install Node.js') {
                        vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
                    } else if (action === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'interactiveMcp.useNpx');
                    }
                });
            } else {
                vscode.window.showErrorMessage(`Failed to start MCP server: ${error.message}`);
            }
        });

        // Wait a moment for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return mcpServerProcess !== undefined;
    } catch (error) {
        console.error('Error starting MCP server:', error);
        vscode.window.showErrorMessage(`Error starting MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}

function stopLocalMcpServer() {
    if (mcpServerProcess) {
        mcpServerProcess.kill();
        mcpServerProcess = undefined;
        console.log('MCP server stopped');
    }
}

function getServerPath(context: vscode.ExtensionContext): string | null {
    // Try bundled server first
    const bundledServerPath = path.join(context.extensionPath, 'bundled-server', 'dist', 'index.js');
    
    // Check if bundled server exists
    try {
        const fs = require('fs');
        if (fs.existsSync(bundledServerPath)) {
            return bundledServerPath;
        }
    } catch (error) {
        console.error('Error checking bundled server:', error);
    }

    // Check custom server path from settings
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const customPath = config.get<string>('serverPath');
    if (customPath && customPath.trim()) {
        return customPath;
    }

    return null;
}

async function connectToMcpServer(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const port = config.get<number>('serverPort') || 8547;
    const autoStartServer = config.get<boolean>('autoStartServer');

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        vscode.window.showInformationMessage('Already connected to MCP server');
        return;
    }

    // Try to start local server if auto-start is enabled
    if (autoStartServer) {
        const serverStarted = await startLocalMcpServer(context);
        if (!serverStarted) {
            const action = await vscode.window.showWarningMessage(
                'Could not start local MCP server. Try connecting to an external server?',
                'Connect Anyway', 'Cancel'
            );
            if (action !== 'Connect Anyway') {
                return;
            }
        }
    }

    wsClient = new WebSocket(`ws://localhost:${port}`);

    wsClient.on('open', () => {
        console.log('Connected to MCP server');
        statusBarItem.text = "$(check) MCP Connected";
        statusBarItem.tooltip = "Connected to MCP server (click to disconnect)";
        statusBarItem.command = 'interactiveMcp.disconnect';
        vscode.window.showInformationMessage('Connected to Interactive MCP server');
    });

    wsClient.on('message', async (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString());
            await handleMcpRequest(message);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    wsClient.on('close', () => {
        console.log('Disconnected from MCP server');
        statusBarItem.text = "$(plug) MCP Disconnected";
        statusBarItem.tooltip = "Click to connect to MCP server";
        statusBarItem.command = 'interactiveMcp.connect';
        vscode.window.showWarningMessage('Disconnected from Interactive MCP server');
    });

    wsClient.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
        vscode.window.showErrorMessage(`MCP connection error: ${error.message}`);
    });
}

function disconnectFromMcpServer() {
    if (wsClient) {
        wsClient.close();
        wsClient = undefined;
    }
}

async function handleMcpRequest(message: any) {
    if (message.type === 'request') {
        let response: any;

        switch (message.inputType) {
            case 'buttons':
                response = await handleButtonsRequest(message.options);
                break;
            case 'text':
                response = await handleTextRequest(message.options);
                break;
            case 'confirm':
                response = await handleConfirmRequest(message.options);
                break;

            default:
                console.error('Unknown input type:', message.inputType);
                return;
        }

        // Send response back to MCP server
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
            wsClient.send(JSON.stringify({
                type: 'response',
                requestId: message.requestId,
                response: response
            }));
        }
    } else if (message.type === 'notification') {
        showNotification(message.notificationType, message.message);
    } else if (message.type === 'command') {
        handleCommand(message.command, message.options);
    }
}

async function handleButtonsRequest(options: any): Promise<any> {
    return new Promise((resolve) => {
        // Create a webview panel but try to make it modal-like
        const panel = vscode.window.createWebviewPanel(
            'mcpButtonDialog',
            '', // Empty title to minimize tab appearance
            { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: []
            }
        );

        // Get current theme
        const currentTheme = vscode.window.activeColorTheme.kind;
        const isDark = currentTheme === vscode.ColorThemeKind.Dark || currentTheme === vscode.ColorThemeKind.HighContrast;

        // Create custom HTML for the modal with improved styling
        panel.webview.html = createButtonDialogHTML(options, isDark);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'buttonClicked') {
                    resolve({ value: message.value });
                    panel.dispose();
                } else if (message.command === 'textInput') {
                    resolve({ value: message.text });
                    panel.dispose();
                } else if (message.command === 'cancelled') {
                    resolve({ value: null });
                    panel.dispose();
                }
            }
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            resolve({ value: null });
        });
    });
}

function createButtonDialogHTML(options: any, isDark: boolean): string {
    const bgColor = isDark ? '#1e1e1e' : '#ffffff';
    const textColor = isDark ? '#cccccc' : '#333333';
    const buttonBg = isDark ? '#0e639c' : '#007acc';
    const buttonHover = isDark ? '#1177bb' : '#005a9e';
    const borderColor = isDark ? '#3c3c3c' : '#e1e1e1';
    const overlayBg = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)';

    const buttonElements = options.options.map((opt: any) => 
        `<button class="option-btn" onclick="selectOption('${opt.value}')">
            ${opt.label}
        </button>`
    ).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>User Input</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: ${overlayBg};
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .modal-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: ${overlayBg};
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }
            
            .dialog-container {
                background: ${bgColor};
                border: 1px solid ${borderColor};
                border-radius: 6px;
                padding: 24px;
                max-width: 450px;
                width: 100%;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                text-align: center;
                animation: slideIn 0.2s ease-out;
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: scale(0.9) translateY(-20px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            
            .dialog-title {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 8px;
                color: ${textColor};
            }
            
            .dialog-message {
                font-size: 14px;
                margin-bottom: 20px;
                line-height: 1.4;
                color: ${textColor};
                opacity: 0.9;
            }
            
            .buttons-container {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 16px;
            }
            
            .option-btn {
                background: ${buttonBg};
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
                text-align: left;
                min-height: 36px;
            }
            
            .option-btn:hover {
                background: ${buttonHover};
                transform: translateY(-1px);
            }
            
            .text-input-section {
                border-top: 1px solid ${borderColor};
                padding-top: 16px;
                display: none;
                animation: fadeIn 0.2s ease-out;
            }
            
            .text-input-section.show {
                display: block;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .text-input {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid ${borderColor};
                border-radius: 4px;
                background: ${bgColor};
                color: ${textColor};
                font-size: 13px;
                margin-bottom: 12px;
                outline: none;
            }
            
            .text-input:focus {
                border-color: ${buttonBg};
                box-shadow: 0 0 0 2px ${buttonBg}20;
            }
            
            .control-buttons {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            
            .text-btn {
                background: transparent;
                border: 1px solid ${borderColor};
                color: ${textColor};
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
            }
            
            .text-btn:hover {
                background: ${borderColor};
            }
            
            .action-buttons {
                display: flex;
                gap: 8px;
            }
            
            .cancel-btn {
                background: transparent;
                border: 1px solid ${borderColor};
                color: ${textColor};
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            
            .cancel-btn:hover {
                background: ${borderColor};
            }
            
            .submit-btn {
                background: ${buttonBg};
                color: white;
                border: none;
                padding: 6px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            
            .submit-btn:hover {
                background: ${buttonHover};
            }
        </style>
    </head>
    <body>
        <div class="modal-backdrop">
            <div class="dialog-container">
                <div class="dialog-title">${options.title}</div>
                <div class="dialog-message">${options.message}</div>
                
                <div class="buttons-container">
                    ${buttonElements}
                </div>
                
                <div class="text-input-section" id="textSection">
                    <input type="text" class="text-input" id="textInput" placeholder="Enter your custom response...">
                    <div class="action-buttons">
                        <button class="cancel-btn" onclick="hideTextInput()">Cancel</button>
                        <button class="submit-btn" onclick="submitText()">Submit</button>
                    </div>
                </div>
                
                <div class="control-buttons">
                    <button class="text-btn" onclick="showTextInput()">
                        📝 Custom text
                    </button>
                    <button class="cancel-btn" onclick="cancel()">Close</button>
                </div>
            </div>
        </div>

        ${createQuickPingHTML()}
        <script>
            const vscode = acquireVsCodeApi();
            
            function selectOption(value) {
                vscode.postMessage({
                    command: 'buttonClicked',
                    value: value
                });
            }
            
            function showTextInput() {
                document.getElementById('textSection').classList.add('show');
                document.getElementById('textInput').focus();
            }
            
            function hideTextInput() {
                document.getElementById('textSection').classList.remove('show');
            }
            
            function submitText() {
                const text = document.getElementById('textInput').value.trim();
                if (text) {
                    vscode.postMessage({
                        command: 'textInput',
                        text: text
                    });
                }
            }
            
            function cancel() {
                vscode.postMessage({
                    command: 'cancelled'
                });
            }
            
            // Handle Enter key in text input
            document.getElementById('textInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    submitText();
                }
            });
            
            // Handle Escape key to cancel
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    cancel();
                }
            });
        </script>
    </body>
    </html>`;
}

function createConfirmHTML(options: any, isDark: boolean): string {
    const bgColor = isDark ? '#1e1e1e' : '#ffffff';
    const textColor = isDark ? '#cccccc' : '#333333';
    const borderColor = isDark ? '#404040' : '#cccccc';
    const buttonBg = isDark ? '#0e639c' : '#007acc';
    const buttonHover = isDark ? '#1177bb' : '#005a9e';
    const cancelBg = isDark ? '#3c3c3c' : '#e1e1e1';
    const cancelHover = isDark ? '#505050' : '#d4d4d4';
    const cancelText = isDark ? '#cccccc' : '#333333';

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: rgba(0, 0, 0, 0.5);
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    backdrop-filter: blur(2px);
                }
                .modal {
                    background-color: ${bgColor};
                    border: 1px solid ${borderColor};
                    border-radius: 8px;
                    padding: 24px;
                    min-width: 400px;
                    max-width: 600px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    animation: slideIn 0.2s ease-out;
                }
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-20px) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                .title {
                    font-size: 18px;
                    font-weight: 600;
                    color: ${textColor};
                    margin-bottom: 16px;
                    text-align: center;
                }
                .message {
                    font-size: 14px;
                    color: ${textColor};
                    margin-bottom: 24px;
                    line-height: 1.5;
                    text-align: center;
                }
                .buttons {
                    display: flex;
                    gap: 12px;
                    justify-content: center;
                }
                button {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 4px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    min-width: 80px;
                }
                .confirm-btn {
                    background-color: ${buttonBg};
                    color: white;
                }
                .confirm-btn:hover {
                    background-color: ${buttonHover};
                    transform: translateY(-1px);
                }
                .cancel-btn {
                    background-color: ${cancelBg};
                    color: ${cancelText};
                }
                .cancel-btn:hover {
                    background-color: ${cancelHover};
                    transform: translateY(-1px);
                }
            </style>
        </head>
        <body>
            <div class="modal">
                <div class="title">${options.title || 'Confirm'}</div>
                <div class="message">${options.message}</div>
                <div class="buttons">
                    <button class="cancel-btn" onclick="sendCancel()">No</button>
                    <button class="confirm-btn" onclick="sendConfirm()" autofocus>Yes</button>
                </div>
            </div>
            ${createQuickPingHTML()}
            <script>
                const vscode = acquireVsCodeApi();
                
                function sendConfirm() {
                    vscode.postMessage({
                        command: 'confirmed',
                        confirmed: true
                    });
                }
                
                function sendCancel() {
                    vscode.postMessage({
                        command: 'confirmed',
                        confirmed: false
                    });
                }
                
                // Keyboard shortcuts
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        sendConfirm();
                    } else if (e.key === 'Escape') {
                        sendCancel();
                    }
                });
                
                // Focus the confirm button
                document.querySelector('.confirm-btn').focus();
            </script>
        </body>
        </html>
    `;
}

function createTextInputHTML(options: any, isDark: boolean): string {
    const bgColor = isDark ? '#1e1e1e' : '#ffffff';
    const textColor = isDark ? '#cccccc' : '#333333';
    const borderColor = isDark ? '#404040' : '#cccccc';
    const inputBg = isDark ? '#3c3c3c' : '#ffffff';
    const inputBorder = isDark ? '#555555' : '#cccccc';
    const buttonBg = isDark ? '#0e639c' : '#007acc';
    const buttonHover = isDark ? '#1177bb' : '#005a9e';
    const cancelBg = isDark ? '#3c3c3c' : '#e1e1e1';
    const cancelHover = isDark ? '#505050' : '#d4d4d4';
    const cancelText = isDark ? '#cccccc' : '#333333';

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: rgba(0, 0, 0, 0.5);
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    backdrop-filter: blur(2px);
                }
                .modal {
                    background-color: ${bgColor};
                    border: 1px solid ${borderColor};
                    border-radius: 8px;
                    padding: 24px;
                    min-width: 450px;
                    max-width: 600px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    animation: slideIn 0.2s ease-out;
                }
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-20px) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                .title {
                    font-size: 18px;
                    font-weight: 600;
                    color: ${textColor};
                    margin-bottom: 8px;
                    text-align: center;
                }
                .prompt {
                    font-size: 14px;
                    color: ${textColor};
                    margin-bottom: 16px;
                    line-height: 1.5;
                    text-align: center;
                }
                .input-container {
                    margin-bottom: 20px;
                }
                input[type="text"] {
                    width: 100%;
                    padding: 12px;
                    border: 1px solid ${inputBorder};
                    border-radius: 4px;
                    background-color: ${inputBg};
                    color: ${textColor};
                    font-size: 14px;
                    font-family: inherit;
                }
                input[type="text"]:focus {
                    outline: none;
                    border-color: ${buttonBg};
                    box-shadow: 0 0 0 2px rgba(14, 99, 156, 0.2);
                }
                .buttons {
                    display: flex;
                    gap: 12px;
                    justify-content: center;
                }
                button {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 4px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    min-width: 80px;
                }
                .submit-btn {
                    background-color: ${buttonBg};
                    color: white;
                }
                .submit-btn:hover {
                    background-color: ${buttonHover};
                    transform: translateY(-1px);
                }
                .cancel-btn {
                    background-color: ${cancelBg};
                    color: ${cancelText};
                }
                .cancel-btn:hover {
                    background-color: ${cancelHover};
                    transform: translateY(-1px);
                }
            </style>
        </head>
        <body>
            <div class="modal">
                <div class="title">${options.title || 'Enter Text'}</div>
                <div class="prompt">${options.prompt}</div>
                <div class="input-container">
                    <input type="text" id="textInput" placeholder="${options.placeholder || ''}" value="${options.defaultValue || ''}" autofocus>
                </div>
                <div class="buttons">
                    <button class="cancel-btn" onclick="sendCancel()">Cancel</button>
                    <button class="submit-btn" onclick="sendSubmit()">Submit</button>
                </div>
            </div>
            ${createQuickPingHTML()}
            <script>
                const vscode = acquireVsCodeApi();
                const input = document.getElementById('textInput');
                
                function sendSubmit() {
                    vscode.postMessage({
                        command: 'textSubmitted',
                        text: input.value
                    });
                }
                
                function sendCancel() {
                    vscode.postMessage({
                        command: 'cancelled'
                    });
                }
                
                // Keyboard shortcuts
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        sendSubmit();
                    } else if (e.key === 'Escape') {
                        sendCancel();
                    }
                });
                
                // Auto-focus the input
                input.focus();
                input.select();
            </script>
        </body>
        </html>
    `;
}

async function handleTextRequest(options: any): Promise<any> {
    return new Promise((resolve) => {
        // Create a webview panel for text input
        const panel = vscode.window.createWebviewPanel(
            'mcpTextDialog',
            '',
            { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: []
            }
        );

        // Get current theme
        const currentTheme = vscode.window.activeColorTheme.kind;
        const isDark = currentTheme === vscode.ColorThemeKind.Dark || currentTheme === vscode.ColorThemeKind.HighContrast;

        // Create custom HTML for text input
        panel.webview.html = createTextInputHTML(options, isDark);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'textSubmitted') {
                    resolve({ value: message.text });
                    panel.dispose();
                } else if (message.command === 'cancelled') {
                    resolve({ value: null });
                    panel.dispose();
                }
            }
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            resolve({ value: null });
        });
    });
}

async function handleConfirmRequest(options: any): Promise<any> {
    return new Promise((resolve) => {
        // Create a webview panel for confirmation
        const panel = vscode.window.createWebviewPanel(
            'mcpConfirmDialog',
            '',
            { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: []
            }
        );

        // Get current theme
        const currentTheme = vscode.window.activeColorTheme.kind;
        const isDark = currentTheme === vscode.ColorThemeKind.Dark || currentTheme === vscode.ColorThemeKind.HighContrast;

        // Create custom HTML for confirmation
        panel.webview.html = createConfirmHTML(options, isDark);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'confirmed') {
                    resolve({ confirmed: message.confirmed });
                    panel.dispose();
                } else if (message.command === 'cancelled') {
                    resolve({ confirmed: false });
                    panel.dispose();
                }
            }
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            resolve({ confirmed: false });
        });
    });
}

async function handleCommand(command: string, options: any) {
    switch (command) {
        case 'focus_chat':
            await focusChatView(options.chatTitle);
            break;
        default:
            console.error('Unknown command:', command);
    }
}

async function focusChatView(chatTitle?: string) {
    try {
        // Get all available commands
        const commands = await vscode.commands.getCommands();
        
        // Look for chat-related focus commands
        const chatFocusCommands = commands.filter(cmd => 
            cmd.includes('focus') && cmd.includes('chat') ||
            cmd.includes('Focus on Chat View') ||
            cmd.includes('chat') && cmd.includes('view')
        );
        
        console.log('Available chat focus commands:', chatFocusCommands);
        
        // Try to find the specific command pattern you mentioned
        let targetCommand = null;
        
        if (chatTitle) {
            // Look for a command that includes the chat title
            targetCommand = commands.find(cmd => cmd.includes(chatTitle));
        }
        
        if (!targetCommand) {
            // Fallback to generic chat focus commands
            const possibleCommands = [
                'workbench.action.chat.focus',
                'workbench.view.chat',
                'workbench.panel.chat.focus',
                'chat.focus',
                'claude.focusChat',
                'cursor.focusChat'
            ];
            
            for (const cmd of possibleCommands) {
                if (commands.includes(cmd)) {
                    targetCommand = cmd;
                    break;
                }
            }
        }
        
        if (targetCommand) {
            await vscode.commands.executeCommand(targetCommand);
            console.log(`Executed focus command: ${targetCommand}`);
        } else {
            // Fallback: try to focus on the chat panel or sidebar
            await vscode.commands.executeCommand('workbench.action.focusSideBar');
            console.log('Fallback: focused on sidebar');
        }
        
    } catch (error) {
        console.error('Error focusing chat view:', error);
        // Final fallback - show a notification
        vscode.window.showInformationMessage(
            chatTitle ? 
                `💬 Please focus on chat: "${chatTitle}"` : 
                '💬 Please return to the chat view'
        );
    }
}

function showNotification(type: string, message: string) {
    // Play notification sound first
    playNotificationSound();
    
    switch (type) {
        case 'info':
            vscode.window.showInformationMessage(message);
            break;
        case 'warning':
            vscode.window.showWarningMessage(message);
            break;
        case 'error':
            vscode.window.showErrorMessage(message);
            break;
    }
}

// Helper function to play notification sound
function playNotificationSound() {
    // Create a temporary, minimal webview just to play the sound
    const tempPanel = vscode.window.createWebviewPanel(
        'soundPlayer',
        '',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: []
        }
    );

    // Set HTML with just the audio element, minimal and hidden
    tempPanel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { 
                    margin: 0; 
                    padding: 0; 
                    background: transparent; 
                    width: 1px; 
                    height: 1px; 
                    overflow: hidden; 
                }
            </style>
        </head>
        <body>
            ${createWarmChimeHTML()}
            <script>
                // Close the panel after playing sound
                setTimeout(() => {
                    const vscode = acquireVsCodeApi();
                    vscode.postMessage({ command: 'close' });
                }, 200);
            </script>
        </body>
        </html>
    `;

    // Handle message to close the panel
    tempPanel.webview.onDidReceiveMessage(message => {
        if (message.command === 'close') {
            tempPanel.dispose();
        }
    });

    // Auto-dispose after 300ms as backup
    setTimeout(() => {
        tempPanel.dispose();
    }, 300);
}

export function deactivate() {
    if (wsClient) {
        wsClient.close();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    
    // Clean up the MCP server process
    stopLocalMcpServer();
}

// Helper function to create Quick Ping sound for interactive dialogs
function createQuickPingHTML(): string {
    return `
        <script>
            // Play Quick Ping sound when page loads
            function playQuickPing() {
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.frequency.value = 1000; // Quick ping frequency
                    oscillator.type = 'sine';
                    
                    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                    gainNode.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.005);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
                    
                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + 0.15);
                } catch (e) {
                    console.log('Audio not supported:', e);
                }
            }
            
            // Play sound when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', playQuickPing);
            } else {
                playQuickPing();
            }
        </script>
    `;
}

// Helper function to create Warm Chime sound for notifications
function createWarmChimeHTML(): string {
    return `
        <script>
            // Play Warm Chime sound when page loads
            function playWarmChime() {
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator1 = audioContext.createOscillator();
                    const oscillator2 = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator1.connect(gainNode);
                    oscillator2.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator1.frequency.value = 523; // C5
                    oscillator2.frequency.value = 659; // E5 (major third)
                    oscillator1.type = 'sine';
                    oscillator2.type = 'sine';
                    
                    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                    gainNode.gain.linearRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.6);
                    
                    oscillator1.start(audioContext.currentTime);
                    oscillator2.start(audioContext.currentTime);
                    oscillator1.stop(audioContext.currentTime + 0.6);
                    oscillator2.stop(audioContext.currentTime + 0.6);
                } catch (e) {
                    console.log('Audio not supported:', e);
                }
            }
            
            // Play sound when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', playWarmChime);
            } else {
                playWarmChime();
            }
        </script>
    `;
}

 