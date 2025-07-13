import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

let wsClient: WebSocket | undefined;
let statusBarItem: vscode.StatusBarItem;
let mcpServerProcess: ChildProcess | undefined;
let routerProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel;
let extensionPath: string;
let chimeToggleItem: vscode.StatusBarItem;
let workspaceId: string;
let sessionId: string;
let lastActivityTime: number = 0;
let activityMonitor: NodeJS.Timeout | undefined;

// Logging helper functions
function logInfo(message: string) {
    const timestamp = new Date().toISOString();
    if (outputChannel) {
        outputChannel.appendLine(`[${timestamp}] INFO: ${message}`);
    }
}

function logError(message: string, error?: any) {
    const timestamp = new Date().toISOString();
    if (outputChannel) {
        const errorDetails = error ? ` - ${error.message || error}` : '';
        outputChannel.appendLine(`[${timestamp}] ERROR: ${message}${errorDetails}`);
    }
}

function logDebug(message: string) {
    const timestamp = new Date().toISOString();
    if (outputChannel) {
        outputChannel.appendLine(`[${timestamp}] DEBUG: ${message}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize logging first
    outputChannel = vscode.window.createOutputChannel('Interactive MCP');
    context.subscriptions.push(outputChannel);
    extensionPath = context.extensionPath;
    
    logInfo('Interactive MCP Helper is activating...');
    
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(circle-slash) Interactive MCP Tools Off";
    statusBarItem.tooltip = "Click to enable Interactive MCP tools";
    statusBarItem.command = 'interactiveMcp.enable';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    chimeToggleItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    chimeToggleItem.command = 'interactiveMcp.toggleChime';
    updateChimeToggle();
    chimeToggleItem.show();
    context.subscriptions.push(chimeToggleItem);
    context.subscriptions.push(vscode.commands.registerCommand('interactiveMcp.toggleChime', () => {
        const config = vscode.workspace.getConfiguration('interactiveMcp');
        const enabled = config.get<boolean>('chimeEnabled', true);
        config.update('chimeEnabled', !enabled, vscode.ConfigurationTarget.Global);
        updateChimeToggle();
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('interactiveMcp.chimeEnabled')) updateChimeToggle();
    }));

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.enable', () => {
            enableInteractiveMcp(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.disable', () => {
            disableInteractiveMcp();
        })
    );

    // Keep legacy commands as aliases for backward compatibility
    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.connect', () => {
            enableInteractiveMcp(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.disconnect', () => {
            disableInteractiveMcp();
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

    context.subscriptions.push(
        vscode.commands.registerCommand('interactiveMcp.copyMcpConfig', () => {
            copyMcpConfiguration(context, true);
        })
    );

    // Auto-enable tools if configured
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    if (config.get<boolean>('autoConnect')) {
        logInfo('Auto-connect enabled - enabling Interactive MCP tools...');
        // Use the new simplified enable function
        enableInteractiveMcp(context);
    }

    // Show installation notification with MCP config option
    showInstallationWelcome(context);
    
    logInfo('Interactive MCP Helper activation complete');
}

async function startLocalMcpServer(context: vscode.ExtensionContext): Promise<boolean> {
    if (mcpServerProcess) {
        logInfo('MCP server already running in this instance');
        return true;
    }

    // Check if another instance is already running on port 8547
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const port = config.get<number>('serverPort') || 8547;
    
    try {
        // Try to connect to see if server is already running
        const testSocket = new (require('ws'))(`ws://localhost:${port}`);
        
        return new Promise((resolve) => {
            testSocket.on('open', () => {
                logInfo(`MCP server already running on port ${port} (started by another instance)`);
                testSocket.close();
                resolve(true);
            });
            
            testSocket.on('error', () => {
                // No server running, we should start one
                testSocket.close();
                startNewServer(context).then(resolve);
            });
        });
    } catch (error) {
        // Fallback to starting new server
        return startNewServer(context);
    }
}

async function startNewServer(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        const serverPath = getServerPath(context);
        
        if (!serverPath) {
            vscode.window.showErrorMessage('MCP server not found. Please ensure the extension is properly installed.');
            return false;
        }

        logInfo('Starting MCP server at: ' + serverPath);
        
        mcpServerProcess = spawn('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'production' }
        });

        mcpServerProcess.stdout?.on('data', (data) => {
            logDebug('MCP Server stdout: ' + data.toString().trim());
        });

        mcpServerProcess.stderr?.on('data', (data) => {
            logError('MCP Server stderr: ' + data.toString().trim());
        });

        mcpServerProcess.on('close', (code) => {
            logInfo(`MCP server exited with code ${code}`);
            mcpServerProcess = undefined;
        });

        mcpServerProcess.on('error', (error) => {
            logError('Failed to start MCP server', error);
            mcpServerProcess = undefined;
            vscode.window.showErrorMessage(`Failed to start MCP server: ${error.message}`);
        });

        // Wait a moment for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return mcpServerProcess !== undefined;
    } catch (error) {
        logError('Error starting MCP server', error);
        vscode.window.showErrorMessage(`Error starting MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}

function stopLocalMcpServer() {
    if (mcpServerProcess) {
        mcpServerProcess.kill();
        mcpServerProcess = undefined;
        logInfo('MCP server stopped');
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
        logError('Error checking bundled server', error);
    }

    // Check custom server path from settings
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const customPath = config.get<string>('serverPath');
    if (customPath && customPath.trim()) {
        return customPath;
    }

    return null;
}

async function connectToMcpServer(context: vscode.ExtensionContext, retryCount: number = 0) {
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const port = config.get<number>('serverPort') || 8547;
    const autoStartServer = config.get<boolean>('autoStartServer');
    const maxRetries = 3;

    logInfo(`Connection attempt ${retryCount + 1}/${maxRetries + 1} to shared router on port ${port}`);
    
    // Update status bar to show connection attempt
    statusBarItem.text = "$(sync~spin) Interactive MCP Connecting...";
    statusBarItem.tooltip = `Connecting to Interactive MCP router (attempt ${retryCount + 1}/${maxRetries + 1})`;

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        logInfo('Already connected to Interactive MCP router');
        statusBarItem.text = "$(check) Interactive MCP Connected";
        statusBarItem.tooltip = "Connected to Interactive MCP router";
        return;
    }

    // Try to start shared router if auto-start is enabled
    if (autoStartServer) {
        statusBarItem.text = "$(sync~spin) Starting Interactive MCP Router...";
        statusBarItem.tooltip = "Starting Interactive MCP router";
        
        const routerStarted = await startSharedRouter(context);
        logInfo(`Router startup result: ${routerStarted ? 'success' : 'failed/already running'}`);
        
        if (!routerStarted) {
            statusBarItem.text = "$(error) Interactive MCP Router Failed";
            statusBarItem.tooltip = "Interactive MCP router startup failed - click to retry";
            statusBarItem.command = 'interactiveMcp.enable';
            vscode.window.showErrorMessage('Failed to start Interactive MCP router. Please check the output for details.');
            return;
        }
    }

    logInfo(`🔌 Creating WebSocket connection to ws://localhost:${port}`);
    
    try {
        wsClient = new WebSocket(`ws://localhost:${port}`);
        logInfo('📡 WebSocket client created, waiting for connection...');
    } catch (error) {
        logError('❌ Failed to create WebSocket client', error);
        statusBarItem.text = "$(error) Interactive MCP Failed";
        statusBarItem.tooltip = "Failed to create WebSocket - click to retry";
        statusBarItem.command = 'interactiveMcp.enable';
        return;
    }

    wsClient.on('open', () => {
        logInfo('🔗 WebSocket connection established with shared router');
        
        // Register with shared router
        workspaceId = getWorkspaceId(context);
        sessionId = `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        logInfo(`📝 Registering VS Code extension with router`);
        logInfo(`   WorkspaceId: ${workspaceId}`);
        logInfo(`   SessionId: ${sessionId}`);
        
        try {
            wsClient!.send(JSON.stringify({
                type: 'register',
                clientType: 'vscode-extension',
                workspaceId,
                sessionId
            }));
            logInfo('📤 Registration message sent to router');
        } catch (error) {
            logError('❌ Failed to send registration message', error);
            return;
        }
        
        statusBarItem.text = "$(sync~spin) Interactive MCP Pairing...";
        statusBarItem.tooltip = `Connected to router, coordinating workspace pairing...`;
        statusBarItem.command = undefined; // Disable clicking during pairing
        logInfo('✅ VS Code extension successfully connected to Interactive MCP router - coordinating workspace...');
        
        // Set a timeout for workspace pairing
        setTimeout(() => {
            if (statusBarItem.text.includes("Pairing")) {
                logError('Workspace pairing timed out after 10 seconds');
                statusBarItem.text = "$(warning) Interactive MCP Pairing Timeout";
                statusBarItem.tooltip = "Workspace pairing failed - no compatible MCP server found (click to retry)";
                statusBarItem.command = 'interactiveMcp.enable';
                vscode.window.showWarningMessage('Interactive MCP pairing timed out. Make sure Claude Desktop is running with Interactive MCP configured.', 'Retry').then(action => {
                    if (action === 'Retry') {
                        enableInteractiveMcp(context);
                    }
                });
            }
        }, 10000); // 10 second timeout
        
        // Show success message only on first connection or after failures
        if (retryCount > 0) {
            vscode.window.showInformationMessage('Successfully reconnected to Interactive MCP router');
        } else {
            vscode.window.showInformationMessage('Connected to Interactive MCP router - waiting for workspace pairing...');
        }
    });

    wsClient.on('message', async (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'register') {
                logInfo('✅ Registration confirmed by router');
            } else if (message.type === 'heartbeat') {
                logDebug('💓 Heartbeat received from router');
            } else if (message.type === 'workspace-sync-complete') {
                handleWorkspaceSyncComplete(message);
            } else if (message.type === 'request') {
                // Handle tool requests
                await handleMcpRequest(message);
            } else {
                logInfo(`📥 Received ${message.type} message from router`);
            }
        } catch (error) {
            logError('❌ Error handling message from router', error);
        }
    });

    wsClient.on('close', (code, reason) => {
        logInfo(`WebSocket disconnected from shared router (code: ${code}, reason: ${reason || 'unknown'})`);
        
        // Clear the wsClient reference
        wsClient = undefined;
        
        // Determine disconnection type and update status accordingly
        const isNormalClosure = code === 1000;
        const isGoingAway = code === 1001;
        
        if (isNormalClosure || isGoingAway) {
            // Normal disconnection
            statusBarItem.text = "$(circle-slash) Interactive MCP Tools Off";
            statusBarItem.tooltip = "Click to enable Interactive MCP tools";
            logInfo('Normal disconnection from router');
        } else {
            // Unexpected disconnection
            statusBarItem.text = "$(warning) Interactive MCP Connection Lost";
            statusBarItem.tooltip = `Connection lost (code: ${code}) - click to reconnect`;
            
            vscode.window.showWarningMessage(
                `Lost connection to Interactive MCP router (code: ${code})`,
                'Reconnect'
            ).then(action => {
                if (action === 'Reconnect') {
                    setTimeout(() => connectToMcpServer(context, 0), 500);
                }
            });
            
            // Auto-reconnect for unexpected disconnections if auto-connect is enabled
            const config = vscode.workspace.getConfiguration('interactiveMcp');
            if (config.get<boolean>('autoConnect') && retryCount === 0) {
                logInfo('Attempting automatic reconnection in 3 seconds...');
                statusBarItem.text = "$(sync~spin) Interactive MCP Auto-reconnecting...";
                statusBarItem.tooltip = "Automatically reconnecting...";
                setTimeout(() => {
                    enableInteractiveMcp(context);
                }, 3000);
                return;
            }
        }
        
        statusBarItem.command = 'interactiveMcp.enable';
    });

    wsClient.on('error', (error: Error) => {
        logError('WebSocket connection error', error);
        
        // Add retry logic
        if (retryCount < maxRetries) {
            const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
            logInfo(`Connection failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            
            setTimeout(() => {
                connectToMcpServer(context, retryCount + 1);
            }, retryDelay);
        } else {
            logError('Max connection retries exceeded');
            
            // Show detailed error message with troubleshooting steps
            const troubleshootAction = 'Troubleshoot';
            const retryAction = 'Retry';
            vscode.window.showErrorMessage(
                `Interactive MCP connection failed after ${maxRetries + 1} attempts. ${error.message || 'Unknown connection error'}`,
                troubleshootAction,
                retryAction
            ).then(action => {
                if (action === troubleshootAction) {
                    // Show troubleshooting information
                    vscode.window.showInformationMessage(
                        'Troubleshooting: 1) Check if another application is using port ' + port + 
                        ', 2) Restart VS Code, 3) Check the "Interactive MCP" output panel for detailed logs'
                    );
                } else if (action === retryAction) {
                    // Retry connection
                    setTimeout(() => connectToMcpServer(context, 0), 1000);
                }
            });
            
            // Update status bar to show failed state
            statusBarItem.text = "$(error) Interactive MCP Failed";
            statusBarItem.tooltip = `Connection failed after ${maxRetries + 1} attempts - click to retry`;
            statusBarItem.command = 'interactiveMcp.enable';
        }
    });
}

function disconnectFromMcpServer() {
    if (wsClient) {
        wsClient.close();
        wsClient = undefined;
    }
}

// New simplified enable function - does everything needed to get tools working
async function enableInteractiveMcp(context: vscode.ExtensionContext) {
    logInfo('🚀 Enabling Interactive MCP tools...');
    
    // Update status to show we're starting
    statusBarItem.text = "$(sync~spin) Interactive MCP Starting...";
    statusBarItem.tooltip = "Setting up Interactive MCP tools...";
    statusBarItem.command = undefined; // Disable clicking while starting
    
    try {
        // Step 1: Ensure router is running (this handles port conflicts)
        await ensureRouterRunning(context);
        
        // Step 2: Connect to router and coordinate workspace
        await connectToMcpServer(context, 0);
        
        logInfo('✅ Interactive MCP tools enabled successfully');
    } catch (error) {
        logError('❌ Failed to enable Interactive MCP tools', error);
        
        // Set error state
        statusBarItem.text = "$(error) Interactive MCP Error";
        statusBarItem.tooltip = `Failed to start: ${error instanceof Error ? error.message : 'Unknown error'} (click to retry)`;
        statusBarItem.command = 'interactiveMcp.enable';
        
        vscode.window.showErrorMessage(`Failed to enable Interactive MCP tools: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Retry').then(action => {
            if (action === 'Retry') {
                enableInteractiveMcp(context);
            }
        });
    }
}

// New simplified disable function
function disableInteractiveMcp() {
    logInfo('🛑 Disabling Interactive MCP tools...');
    
    // Stop activity monitoring
    stopActivityMonitoring();
    
    // Disconnect from router
    disconnectFromMcpServer();
    
    // Update status
    statusBarItem.text = "$(circle-slash) Interactive MCP Tools Off";
    statusBarItem.tooltip = "Click to enable Interactive MCP tools";
    statusBarItem.command = 'interactiveMcp.enable';
    
    logInfo('✅ Interactive MCP tools disabled');
}

// Ensure router is running with robust port management
async function ensureRouterRunning(context: vscode.ExtensionContext): Promise<void> {
    logInfo('🔧 Ensuring router is running...');
    
    const success = await startSharedRouter(context);
    if (!success) {
        // Try a more direct test - maybe the detection failed but router is actually running
        const config = vscode.workspace.getConfiguration("interactiveMcp");
        const port = config.get<number>("serverPort") || 8547;
        
        logInfo('🔄 Router startup reported failure, testing direct connection...');
        const isActuallyRunning = await testIfOurRouter(port);
        
        if (isActuallyRunning) {
            logInfo('✅ Router is actually running despite startup failure - proceeding');
            return;
        }
        
        // Router is really not working
        logError('❌ Router startup failed and direct test also failed');
        throw new Error(`Failed to start Interactive MCP router on port ${port}. This usually means another application is using the port. Please check the output logs for details.`);
    }
    
    logInfo('✅ Router is running and ready');
}

function handleWorkspaceSyncComplete(message: any) {
    const { finalWorkspace, mcpSessionId, vscodeSessionId } = message;
    
    logInfo(`🎉 Workspace coordination complete! Final workspace: ${finalWorkspace}`);
    logInfo(`🔗 Now paired with MCP server session: ${mcpSessionId}`);
    
    // Update our workspace ID if needed
    workspaceId = finalWorkspace;
    
    // Update status to show tools are ready - this is what users care about!
    statusBarItem.text = "$(check-all) Interactive MCP Tools Ready";
    statusBarItem.tooltip = `✅ Tools ready for AI assistants! Workspace: ${finalWorkspace} (click to disable)`;
    statusBarItem.command = 'interactiveMcp.disable';
    
    // Show success notification
    vscode.window.showInformationMessage('🎉 Interactive MCP tools are ready! AI assistants can now show popups.');
    
    // Start activity monitoring
    startActivityMonitoring();
}

// Start monitoring for MCP activity to detect when tools are disabled
function startActivityMonitoring() {
    lastActivityTime = Date.now();
    
    // Clear any existing monitor
    if (activityMonitor) {
        clearInterval(activityMonitor);
    }
    
    // Check every 30 seconds if we've received any activity
    activityMonitor = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        
        // If no activity for 2 minutes and status shows tools ready, tools might be disabled
        if (timeSinceLastActivity > 120000 && statusBarItem.text.includes("Tools Ready")) {
            logInfo('🔍 No MCP activity detected for 2 minutes - tools may be disabled in Claude Desktop');
            statusBarItem.text = "$(question) Interactive MCP Tools Inactive";
            statusBarItem.tooltip = "No recent activity detected. Tools may be disabled in Claude Desktop. (click to refresh)";
            statusBarItem.command = 'interactiveMcp.enable';
        }
    }, 30000);
}

// Stop activity monitoring
function stopActivityMonitoring() {
    if (activityMonitor) {
        clearInterval(activityMonitor);
        activityMonitor = undefined;
    }
}

async function handleMcpRequest(message: any) {
    if (message.type === 'request') {
        // Update activity timestamp
        lastActivityTime = Date.now();
        logInfo(`📥 Received ${message.inputType} request - tools are active`);
        
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
                logError('Unknown input type: ' + message.inputType);
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
        playAlertSound();

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
                animation: slideIn 0.2s ease-out, glow 3s ease-in-out infinite;
            }
            
            /* Subtle attention-grabbing glow effect */
            @keyframes glow {
                0%, 100% { 
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    border-color: ${borderColor};
                }
                50% { 
                    box-shadow: 0 8px 32px rgba(14, 99, 156, 0.5);
                    border-color: ${buttonBg}80;
                }
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
    const overlayBg = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)';

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
                    background: ${overlayBg};
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .modal {
                    background-color: ${bgColor};
                    border: 1px solid ${borderColor};
                    border-radius: 8px;
                    padding: 24px;
                    min-width: 400px;
                    max-width: 600px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    animation: slideIn 0.2s ease-out, glow 3s ease-in-out infinite;
                    text-align: center;
                }
                
                /* Subtle attention-grabbing glow effect */
                @keyframes glow {
                    0%, 100% { 
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        border-color: ${borderColor};
                    }
                    50% { 
                        box-shadow: 0 8px 32px rgba(14, 99, 156, 0.4);
                        border-color: ${buttonBg}80;
                    }
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
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .title {
                    font-size: 18px;
                    font-weight: 600;
                    color: ${textColor};
                    margin-bottom: 16px;
                }
                .message {
                    font-size: 14px;
                    color: ${textColor};
                    margin-bottom: 24px;
                    line-height: 1.5;
                }
                .buttons {
                    display: flex;
                    gap: 12px;
                    justify-content: center;
                    margin-bottom: 16px;
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
                .text-input-section {
                    border-top: 1px solid ${borderColor};
                    padding-top: 16px;
                    display: none;
                    animation: fadeIn 0.2s ease-out;
                }
                .text-input-section.show {
                    display: block;
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
            <div class="modal">
                <div class="title">${options.title || 'Confirm'}</div>
                <div class="message">${options.message}</div>
                
                <div class="buttons">
                    <button class="cancel-btn" onclick="sendCancel()">${options.cancelText || 'No'}</button>
                    <button class="confirm-btn" onclick="sendConfirm()" autofocus>${options.confirmText || 'Yes'}</button>
                </div>
                
                <div class="text-input-section" id="textSection">
                    <input type="text" class="text-input" id="textInput" placeholder="Explain your choice...">
                    <div class="action-buttons">
                        <button class="cancel-btn" onclick="hideTextInput()">Cancel</button>
                        <button class="submit-btn" onclick="submitText()">Submit</button>
                    </div>
                </div>
                
                <div class="control-buttons">
                    <button class="text-btn" onclick="showTextInput()">
                        📝 Custom response
                    </button>
                </div>
            </div>
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
                
                // Keyboard shortcuts
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !document.getElementById('textSection').classList.contains('show')) {
                        sendConfirm();
                    } else if (e.key === 'Escape') {
                        if (document.getElementById('textSection').classList.contains('show')) {
                            hideTextInput();
                        } else {
                            sendCancel();
                        }
                    }
                });
                
                // Handle Enter key in text input
                document.getElementById('textInput').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        submitText();
                    }
                });
                
                // Focus the confirm button initially
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
                    animation: slideIn 0.2s ease-out, glow 3s ease-in-out infinite;
                }
                
                /* Subtle attention-grabbing glow effect */
                @keyframes glow {
                    0%, 100% { 
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        border-color: ${borderColor};
                    }
                    50% { 
                        box-shadow: 0 8px 32px rgba(14, 99, 156, 0.4);
                        border-color: ${buttonBg}80;
                    }
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
        playAlertSound();

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
        playAlertSound();

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
                } else if (message.command === 'textInput') {
                    resolve({ value: message.text });
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



export function deactivate() {
    if (wsClient) {
        wsClient.close();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    
    // Clean up the shared router process
    if (routerProcess) {
        routerProcess.kill();
        routerProcess = undefined;
    }
}


function playAlertSound() {
  const config = vscode.workspace.getConfiguration('interactiveMcp');
  if (!config.get<boolean>('chimeEnabled', true)) return;
  const volume = config.get<number>('chimeVolume', 50) / 100;
  const soundPath = path.join(extensionPath, 'sounds', 'chime.wav');
  outputChannel.appendLine(`[Sound] Attempting playback at: ${soundPath}`);
  if (!fs.existsSync(soundPath)) {
    outputChannel.appendLine('[Sound] Error: File not found! Check if sounds/chime.wav is bundled.');
    return;
  }
  let command;
  let args = [];
  if (process.platform === 'win32') {
    command = 'powershell';
    args = ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${soundPath.replace(/\//g, '\\')}').PlaySync()`];
  } else if (process.platform === 'darwin') {
    command = 'afplay';
    args = [soundPath, '-v', volume.toString()];
  } else {
    command = 'aplay';
    args = ['-v', volume.toString(), soundPath];
  }
  outputChannel.appendLine(`[Sound] Spawning: ${command} ${args.join(' ')}`);
  const proc = spawn(command, args, { shell: true });
  proc.stdout.on('data', (data) => outputChannel.appendLine(`[Sound] stdout: ${data}`));
  proc.stderr.on('data', (data) => outputChannel.appendLine(`[Sound] stderr: ${data}`));
  proc.on('error', (err) => {
    outputChannel.appendLine(`[Sound] Playback error: ${err.message}`);
  });
  proc.on('close', (code) => {
    outputChannel.appendLine(`[Sound] Process closed with code ${code}`);
  });
}

function updateChimeToggle() {
  const config = vscode.workspace.getConfiguration('interactiveMcp');
  const enabled = config.get<boolean>('chimeEnabled', true);
  chimeToggleItem.text = enabled ? '$(music)' : '$(mute)';
  chimeToggleItem.tooltip = enabled ? 'Interactive MCP Chime ON (click to disable)' : 'Interactive MCP Chime OFF (click to enable)';
}

// Generate and copy MCP configuration JSON to clipboard
async function copyMcpConfiguration(context: vscode.ExtensionContext, fromCommandPalette: boolean = false) {
    try {
        const serverPath = getServerPath(context);
        
        if (!serverPath) {
            vscode.window.showErrorMessage('MCP server not found. Please ensure the extension is properly installed.');
            return false;
        }

        const mcpServerConfig = {
            "command": "node",
            "args": [serverPath]
        };

        const configJson = `"interactive-mcp": ${JSON.stringify(mcpServerConfig, null, 2)}`;
        await vscode.env.clipboard.writeText(configJson);
        
        if (fromCommandPalette) {
            vscode.window.showInformationMessage(
                '✅ MCP configuration copied to clipboard!'
            );
        }

        return true;

    } catch (error) {
        logError('Error generating MCP config', error);
        vscode.window.showErrorMessage(`Failed to generate MCP configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}


// Show installation welcome message with MCP config option
async function showInstallationWelcome(context: vscode.ExtensionContext) {
    const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
    
    if (!hasShownWelcome) {
        // Mark as shown first to avoid repeated prompts
        await context.globalState.update('hasShownWelcome', true);
        
        await showWelcomeNotification(context);
    }
}

// Show stateful welcome notification that updates after copying
async function showWelcomeNotification(context: vscode.ExtensionContext, hasCopied: boolean = false) {
    const message = hasCopied 
        ? '✅ MCP configuration copied to clipboard!'
        : '🎉 Interactive MCP Helper installed! Get your MCP configuration to connect AI assistants.';
    
    const copyButton = hasCopied ? 'Copied ✓' : 'Copy MCP JSON';
    
    const action = await vscode.window.showInformationMessage(
        message,
        copyButton,
        'Dismiss'
    );

    if (action === copyButton && !hasCopied) {
        const success = await copyMcpConfiguration(context, false);
        if (success) {
            // Show updated notification with copied state
            await showWelcomeNotification(context, true);
        }
    }
}

 

// Get workspace identifier for shared router registration
function getWorkspaceId(context: vscode.ExtensionContext): string {
    // Try to get workspace folder path
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // Use first workspace folder for multi-root workspaces
        return path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath);
    }
    
    // Try workspace file if available
    if (vscode.workspace.workspaceFile) {
        return path.resolve(vscode.workspace.workspaceFile.fsPath);
    }
    
    // Fallback to extension path (this shouldnt happen in normal usage)
    return path.resolve(context.extensionPath);
}

// Start shared router with smart port conflict resolution
async function startSharedRouter(context: vscode.ExtensionContext): Promise<boolean> {
    logInfo('Starting shared router with smart port management...');
    
    if (routerProcess) {
        logInfo("Router process already running in this instance");
        return true;
    }

    const config = vscode.workspace.getConfiguration("interactiveMcp");
    const port = config.get<number>("serverPort") || 8547;
    
    logInfo(`Checking port ${port} status...`);
    
    // Step 1: Check if something is using the port
    const processInfo = await getProcessUsingPort(port);
    
    if (processInfo) {
        logInfo(`Port ${port} is occupied by PID ${processInfo.pid}`);
        
        // Step 2: Test if it's our router
        const isOurRouter = await testIfOurRouter(port);
        
        if (isOurRouter) {
            logInfo(`Port ${port} has our router running - using existing instance`);
            return true;
        } else {
            logInfo(`Port ${port} has foreign process - attempting to terminate PID ${processInfo.pid}`);
            const killed = await killProcess(processInfo.pid);
            
            if (killed) {
                logInfo(`Successfully terminated PID ${processInfo.pid}`);
                // Wait a moment for port to be freed
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                logError(`Failed to terminate PID ${processInfo.pid}`);
                vscode.window.showErrorMessage(`Port ${port} is occupied and cannot be freed. Please close the application using this port.`);
                return false;
            }
        }
    } else {
        logInfo(`Port ${port} is free`);
    }
    
    // Step 3: Start new router
    return await startNewRouter(context, port);
}

// Start new router instance
async function startNewRouter(context: vscode.ExtensionContext, port: number): Promise<boolean> {
    try {
        logInfo('Starting new router instance...');
        const routerPath = getRouterPath(context);
        
        if (!routerPath) {
            logError("Router executable not found");
            vscode.window.showErrorMessage("Router not found. Please ensure the extension is properly installed.");
            return false;
        }

        logInfo(`Launching router: ${routerPath}`);
        
        // Test if basic process spawning works
        logInfo(`🧪 Testing basic process spawning first...`);
        const testProcess = spawn("node", ["-e", "console.log('TEST OUTPUT'); console.error('TEST ERROR');"], {
            stdio: ["pipe", "pipe", "pipe"]
        });
        
        testProcess.stdout?.on("data", (data) => {
            logInfo(`🧪 Test STDOUT: ${data.toString().trim()}`);
        });
        
        testProcess.stderr?.on("data", (data) => {
            logInfo(`🧪 Test STDERR: ${data.toString().trim()}`);
        });
        
        testProcess.on("close", (code) => {
            logInfo(`🧪 Test process exited with code ${code}`);
        });
        
        // Now start the actual router
        logInfo(`🚀 Starting actual router process...`);
        routerProcess = spawn("node", [routerPath], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, NODE_ENV: "production", PORT: port.toString() }
        });

        routerProcess.stdout?.on("data", (data) => {
            const output = data.toString().trim();
            logInfo("Router STDOUT: " + output);
            
            // Check for specific router startup messages
            if (output.includes("WebSocket router listening")) {
                logInfo("✅ Router successfully started and listening for connections");
            } else if (output.includes("Starting as main module")) {
                logInfo("🚀 Router module initialization detected");
            }
        });

        routerProcess.stderr?.on("data", (data) => {
            const output = data.toString().trim();
            logError("Router STDERR: " + output);
            
            // Check for specific error patterns
            if (output.includes("EADDRINUSE")) {
                logError("❌ Port conflict detected in router stderr");
            }
        });

        routerProcess.on("close", (code) => {
            logInfo(`Router exited with code ${code}`);
            routerProcess = undefined;
        });

        routerProcess.on("error", (error) => {
            logError("Failed to start router", error);
            routerProcess = undefined;
        });

        // Wait for startup and verify
        logInfo('⏳ Waiting 2 seconds for router to start...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (routerProcess) {
            logInfo(`🔍 Testing router connection on port ${port}...`);
            const isListening = await testRouterConnection(port);
            
            if (isListening) {
                logInfo(`✅ Router successfully started and responding on port ${port}`);
                const workspaceId = getWorkspaceId(context);
                logInfo(`📁 Workspace: ${workspaceId}`);
                logInfo(`🎯 Router startup complete - ready for connections`);
                return true;
            } else {
                logError('❌ Router process running but not responding to connections');
                logInfo('💀 Terminating unresponsive router process');
                if (routerProcess) {
                    routerProcess.kill();
                    routerProcess = undefined;
                }
            }
        } else {
            logError('❌ Router process terminated unexpectedly during startup');
        }
        
        return false;
    } catch (error) {
        logError("Error starting router", error);
        return false;
    }
}

// Check what process is using a port
async function getProcessUsingPort(port: number): Promise<{ pid: number; command: string } | null> {
    return new Promise((resolve) => {
        // Try different commands based on platform
        const isWindows = process.platform === 'win32';
        const command = isWindows 
            ? `netstat -ano | findstr :${port}` 
            : `lsof -ti:${port} 2>/dev/null || ss -tlnp | grep :${port}`;
        
        const { spawn } = require('child_process');
        const proc = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
        
        let output = '';
        proc.stdout.on('data', (data: Buffer) => {
            output += data.toString();
        });
        
        proc.on('close', () => {
            if (!output.trim()) {
                resolve(null);
                return;
            }
            
            try {
                if (isWindows) {
                    // Parse Windows netstat output
                    const lines = output.split('\n').filter(line => line.includes(`:${port}`));
                    if (lines.length > 0) {
                        const parts = lines[0].trim().split(/\s+/);
                        const pid = parseInt(parts[parts.length - 1]);
                        if (!isNaN(pid)) {
                            resolve({ pid, command: 'unknown' });
                            return;
                        }
                    }
                } else {
                    // Parse Unix lsof/ss output
                    const pid = parseInt(output.trim().split('\n')[0]);
                    if (!isNaN(pid)) {
                        resolve({ pid, command: 'unknown' });
                        return;
                    }
                }
            } catch (error) {
                logDebug('Error parsing port check output: ' + error);
            }
            
            resolve(null);
        });
        
        proc.on('error', () => resolve(null));
    });
}

// Kill a process by PID
async function killProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const command = isWindows ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
        
        const { spawn } = require('child_process');
        const proc = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
        
        proc.on('close', (code: number | null) => {
            resolve(code === 0);
        });
        
        proc.on('error', () => resolve(false));
    });
}

// Test if an existing WebSocket server is our router
async function testIfOurRouter(port: number): Promise<boolean> {
    logInfo(`🔍 Testing if port ${port} has our router...`);
    
    return new Promise((resolve) => {
        try {
            const testSocket = new (require("ws"))(`ws://localhost:${port}`);
            let resolved = false;
            
            const cleanup = () => {
                if (!resolved) {
                    resolved = true;
                    testSocket.removeAllListeners();
                    if (testSocket.readyState === WebSocket.OPEN) {
                        testSocket.close();
                    }
                }
            };
            
            let heartbeatSent = false;
            
            testSocket.on("open", () => {
                logInfo(`📡 Connected to port ${port}, testing for our router...`);
                // Wait a moment for potential initial heartbeat, then send our own
                setTimeout(() => {
                    if (!resolved && !heartbeatSent) {
                        logInfo(`📤 Sending heartbeat test to port ${port}...`);
                        heartbeatSent = true;
                        testSocket.send(JSON.stringify({ type: 'heartbeat' }));
                    }
                }, 500);
            });
            
            testSocket.on("message", (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    logInfo(`📥 Received message from port ${port}: ${message.type}`);
                    
                    // If we receive any heartbeat (initial or response), it's our router
                    if (message.type === 'heartbeat') {
                        logInfo(`✅ Port ${port} confirmed as our Interactive MCP router`);
                        cleanup();
                        resolve(true);
                    }
                } catch (error) {
                    logInfo(`❌ Port ${port} sent invalid JSON, not our router`);
                    cleanup();
                    resolve(false);
                }
            });
            
            testSocket.on("error", (error: any) => {
                logInfo(`❌ Failed to connect to port ${port}: ${error.message}`);
                cleanup();
                resolve(false);
            });
            
            testSocket.on("close", () => {
                logInfo(`🔌 Connection to port ${port} closed during test`);
                if (!resolved) {
                    cleanup();
                    resolve(false);
                }
            });
            
            // Increased timeout to 5 seconds for more reliability
            setTimeout(() => {
                if (!resolved) {
                    logInfo(`⏰ Port ${port} test timed out after 5 seconds - not our router`);
                    cleanup();
                    resolve(false);
                }
            }, 5000);
        } catch (error) {
            logError(`❌ Error testing port ${port}`, error);
            resolve(false);
        }
    });
}

// Test if router is actually listening on the expected port
async function testRouterConnection(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const testSocket = new (require("ws"))(`ws://localhost:${port}`);
            let resolved = false;
            
            const cleanup = () => {
                if (!resolved) {
                    resolved = true;
                    testSocket.removeAllListeners();
                    if (testSocket.readyState === WebSocket.OPEN) {
                        testSocket.close();
                    }
                }
            };
            
            testSocket.on("open", () => {
                logDebug(`Router connection test successful on port ${port}`);
                cleanup();
                resolve(true);
            });
            
            testSocket.on("error", (error: Error) => {
                logDebug(`Router connection test failed on port ${port}: ${error.message}`);
                cleanup();
                resolve(false);
            });
            
            // Timeout after 2 seconds
            setTimeout(() => {
                if (!resolved) {
                    logDebug(`Router connection test timed out on port ${port}`);
                    cleanup();
                    resolve(false);
                }
            }, 2000);
        } catch (error) {
            logError('Error testing router connection', error);
            resolve(false);
        }
    });
}

// Get router executable path
function getRouterPath(context: vscode.ExtensionContext): string | null {
    // Try bundled router first
    const bundledRouterPath = path.join(context.extensionPath, "bundled-router", "dist", "router.js");
    
    try {
        if (fs.existsSync(bundledRouterPath)) {
            return bundledRouterPath;
        }
    } catch (error) {
        logError('Error checking bundled router', error);
    }

    return null;
}
