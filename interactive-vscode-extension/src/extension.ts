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

// Router startup synchronization
let routerStartupMutex: boolean = false;

// WebSocket connection synchronization
let wsConnectionMutex: boolean = false;

// State Machine for reliable connection management
type ConnectionState = 'DISCONNECTED' | 'STARTING' | 'CONNECTED' | 'READY' | 'ERROR';

// Interface for state transition data
interface StateTransitionData {
    error?: string;
}

// Interface for state machine configuration
interface StateMachineConfig {
    pairingTimeoutMs: number;
    maxRetries: number;
}

class ConnectionStateMachine {
    private currentState: ConnectionState = 'DISCONNECTED';
    private context: vscode.ExtensionContext;
    private pairingTimeout: NodeJS.Timeout | undefined;
    private transitionMutex: boolean = false;
    private operationMutex: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.updateUI();
    }

    getCurrentState(): ConnectionState {
        return this.currentState;
    }

    // Thread-safe state checking
    isInState(state: ConnectionState): boolean {
        return this.currentState === state;
    }

    // Check if state machine is ready for operations
    isReady(): boolean {
        return this.currentState === 'READY' && !this.transitionMutex && !this.operationMutex;
    }

    // Get detailed state information for debugging
    getStateInfo(): { state: ConnectionState; transitionLocked: boolean; operationLocked: boolean; hasPairingTimeout: boolean } {
        return {
            state: this.currentState,
            transitionLocked: this.transitionMutex,
            operationLocked: this.operationMutex,
            hasPairingTimeout: this.pairingTimeout !== undefined
        };
    }

    // Atomic state transition with cleanup and mutex protection
    transition(newState: ConnectionState, data?: { error?: string }) {
        // Prevent concurrent transitions
        if (this.transitionMutex) {
            logInfo(`⚠️ State transition blocked: ${this.currentState} → ${newState} (transition in progress)`);
            return;
        }

        // Validate state transition
        if (!this.isValidTransition(this.currentState, newState)) {
            logError(`❌ Invalid state transition: ${this.currentState} → ${newState}`);
            return;
        }

        this.transitionMutex = true;
        const oldState = this.currentState;
        
        try {
            // Exit current state (cleanup)
            this.exitState(oldState);
            
            // Set new state
            this.currentState = newState;
            
            // Enter new state (setup)
            this.enterState(newState, data);
            
            // Update UI
            this.updateUI();
            
            logInfo(`🔄 State transition: ${oldState} → ${newState}`);
        } catch (error) {
            logError(`❌ Error during state transition ${oldState} → ${newState}`, error);
            // Rollback to previous state on error
            this.currentState = oldState;
            this.updateUI();
        } finally {
            this.transitionMutex = false;
        }
    }

    // Validate if a state transition is allowed
    private isValidTransition(from: ConnectionState, to: ConnectionState): boolean {
        // Allow same-state transitions (idempotent)
        if (from === to) {
            return true;
        }

        // Define valid state transitions
        const validTransitions: Record<ConnectionState, ConnectionState[]> = {
            'DISCONNECTED': ['STARTING', 'ERROR'],
            'STARTING': ['CONNECTED', 'ERROR', 'DISCONNECTED'],
            'CONNECTED': ['READY', 'ERROR', 'DISCONNECTED'],
            'READY': ['DISCONNECTED', 'ERROR'],
            'ERROR': ['STARTING', 'DISCONNECTED', 'READY']
        };

        return validTransitions[from]?.includes(to) || false;
    }

    private exitState(state: ConnectionState) {
        switch (state) {
            case 'CONNECTED':
                // Clear pairing timeout
                if (this.pairingTimeout) {
                    clearTimeout(this.pairingTimeout);
                    this.pairingTimeout = undefined;
                }
                break;
            case 'READY':
                // No special cleanup needed
                break;
            default:
                // No cleanup needed for other states
                break;
        }
    }

    private enterState(state: ConnectionState, data?: { error?: string }) {
        switch (state) {
            case 'STARTING':
                // Will be handled by the enable function
                break;
            case 'CONNECTED':
                // Set pairing timeout (extended to allow for aggressive tool refresh)
                this.pairingTimeout = setTimeout(() => {
                    this.transition('ERROR', { error: 'Workspace pairing timed out. Make sure Claude Desktop is running with Interactive MCP configured.' });
                }, 15000); // Extended from 10s to 15s to allow tool refresh to work
                break;
            case 'READY':
                // Success! No special setup needed
                break;
            case 'ERROR':
                // Log the error
                if (data?.error) {
                    logError('Connection error: ' + data.error);
                }
                
                // Critical: Clean up server processes to allow restart
                logInfo('🧹 Cleaning up server processes after error to enable restart...');
                cleanupAfterError();
                break;
            default:
                break;
        }
    }

    private updateUI() {
        switch (this.currentState) {
            case 'DISCONNECTED':
                statusBarItem.text = "$(circle-slash) Interactive MCP Tools Off";
                statusBarItem.tooltip = "Click to enable Interactive MCP tools";
                statusBarItem.command = 'interactiveMcp.enable';
                break;
            case 'STARTING':
                statusBarItem.text = "$(sync~spin) Interactive MCP Starting...";
                statusBarItem.tooltip = "Setting up Interactive MCP tools...";
                statusBarItem.command = undefined; // Disable clicking
                break;
            case 'CONNECTED':
                statusBarItem.text = "$(sync~spin) Interactive MCP Pairing...";
                statusBarItem.tooltip = "Coordinating workspace pairing...";
                statusBarItem.command = undefined; // Disable clicking
                break;
            case 'READY':
                statusBarItem.text = "$(check-all) Interactive MCP Tools Ready";
                statusBarItem.tooltip = "✅ Tools ready for AI assistants! Click to disable";
                statusBarItem.command = 'interactiveMcp.disable';
                break;
            case 'ERROR':
                statusBarItem.text = "$(circle-slash) Interactive MCP Tools Off";
                statusBarItem.tooltip = "Error occurred - click to try enabling again";
                statusBarItem.command = 'interactiveMcp.enable';
                break;
        }
    }

    // Event handlers with state validation
    handleRouterConnected() {
        if (this.transitionMutex) {
            logInfo('⚠️ Router connected event ignored - transition in progress');
            return;
        }
        
        if (this.currentState === 'STARTING') {
            this.transition('CONNECTED');
        } else {
            logInfo(`⚠️ Router connected event ignored - current state: ${this.currentState}`);
        }
    }

    handleWorkspacePaired() {
        if (this.transitionMutex) {
            logInfo('⚠️ Workspace paired event ignored - transition in progress');
            return;
        }
        
        if (this.currentState === 'CONNECTED') {
            this.transition('READY');
        } else if (this.currentState === 'ERROR') {
            // Allow recovery from ERROR state when workspace coordination completes
            logInfo('🔄 Workspace paired event received in ERROR state - attempting recovery');
            this.transition('READY');
        } else {
            logInfo(`⚠️ Workspace paired event ignored - current state: ${this.currentState}`);
        }
    }

    handleError(error: string) {
        // Error transitions are always allowed to prevent stuck states
        this.transition('ERROR', { error });
        // Release operation lock on error to prevent deadlock
        this.operationMutex = false;
    }

    handleEnable() {
        // Prevent concurrent enable/disable operations
        if (this.operationMutex) {
            logInfo('⚠️ Enable request blocked - operation already in progress');
            return false;
        }

        if (this.currentState === 'DISCONNECTED' || this.currentState === 'ERROR') {
            this.operationMutex = true;
            this.transition('STARTING');
            return true; // Proceed with enable
        }
        
        logInfo(`⚠️ Enable request ignored - current state: ${this.currentState}`);
        return false; // Don't proceed
    }

    handleDisable() {
        // Prevent concurrent enable/disable operations
        if (this.operationMutex) {
            logInfo('⚠️ Disable request blocked - operation already in progress');
            return false;
        }

        if (this.currentState !== 'DISCONNECTED') {
            this.operationMutex = true;
            this.transition('DISCONNECTED');
            return true; // Proceed with disable
        }
        
        logInfo('⚠️ Disable request ignored - already disconnected');
        return false; // Already disconnected
    }

    // Release operation mutex (called after enable/disable completes)
    releaseOperationLock() {
        this.operationMutex = false;
        logDebug('🔓 Operation mutex released');
    }

    // Check if an operation is in progress
    isOperationInProgress(): boolean {
        return this.operationMutex;
    }
}

let connectionStateMachine: ConnectionStateMachine;

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

// Message queue for messages sent during connection transitions
interface QueuedMessage {
    message: any;
    timestamp: number;
    retries: number;
}

let messageQueue: QueuedMessage[] = [];
const MAX_QUEUE_SIZE = 50;
const MAX_MESSAGE_RETRIES = 3;
const MESSAGE_RETRY_DELAY = 1000;

// Robust message sending with validation and queuing
function sendWebSocketMessage(message: any): boolean {
    if (!validateWebSocketState('send')) {
        // Queue message if WebSocket is not ready but might recover
        if (wsClient && (wsClient.readyState === WebSocket.CONNECTING)) {
            queueMessage(message);
            logInfo('📦 Message queued - WebSocket connecting');
            return true; // Optimistic return - message is queued
        }
        return false;
    }
    
    try {
        const messageStr = JSON.stringify(message);
        wsClient!.send(messageStr);
        logDebug(`📤 WebSocket message sent: ${message.type}`);
        return true;
    } catch (error) {
        logError('❌ Failed to send WebSocket message', error);
        
        // Queue message for retry if connection might recover
        if (wsClient && wsClient.readyState !== WebSocket.CLOSED) {
            queueMessage(message);
            logInfo('📦 Message queued for retry after send failure');
        }
        
        return false;
    }
}

// Queue message for later sending
function queueMessage(message: any) {
    // Prevent queue overflow
    if (messageQueue.length >= MAX_QUEUE_SIZE) {
        logInfo('⚠️ Message queue full - removing oldest message');
        messageQueue.shift();
    }
    
    messageQueue.push({
        message,
        timestamp: Date.now(),
        retries: 0
    });
    
    logDebug(`📦 Message queued (queue size: ${messageQueue.length})`);
}

// Process queued messages when connection is restored
async function processMessageQueue() {
    if (messageQueue.length === 0) {
        return;
    }

    logInfo(`📦 Processing ${messageQueue.length} queued messages...`);

    const messagesToProcess = [...messageQueue];
    messageQueue = [];

    for (const queuedMessage of messagesToProcess) {
        const { message, timestamp, retries } = queuedMessage;

        // Skip messages that are too old (older than 30 seconds)
        if (Date.now() - timestamp > 30000) {
            logInfo(`⏰ Skipping expired queued message: ${message.type}`);
            continue;
        }

        // Check if this is an incoming request that needs to be handled
        if (message.type === 'request') {
            logInfo(`📦 Processing queued ${message.inputType} request`);
            try {
                await handleMcpRequest(message);
            } catch (error) {
                logError('❌ Error processing queued request', error);
            }
        } else {
            // This is an outgoing message that needs to be sent
            if (!sendWebSocketMessage(message)) {
                // Re-queue if under retry limit
                if (retries < MAX_MESSAGE_RETRIES) {
                    setTimeout(() => {
                        messageQueue.push({
                            message,
                            timestamp,
                            retries: retries + 1
                        });
                        logDebug(`🔄 Message re-queued for retry ${retries + 1}/${MAX_MESSAGE_RETRIES}`);
                    }, MESSAGE_RETRY_DELAY);
                } else {
                    logError(`❌ Message dropped after ${MAX_MESSAGE_RETRIES} retries: ${message.type}`);
                }
            }
        }
    }
}

// Clear message queue (called on disconnect)
function clearMessageQueue() {
    if (messageQueue.length > 0) {
        logInfo(`🗑️ Clearing ${messageQueue.length} queued messages`);
        messageQueue = [];
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
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initialize state machine (this will set initial UI state)
    connectionStateMachine = new ConnectionStateMachine(context);

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
    logInfo('🔧 Starting MCP server for automatic connection...');

    if (mcpServerProcess) {
        logInfo('✅ MCP server already running in this instance');
        return true;
    }

    // Always start a new MCP server - they communicate via stdio, not ports
    logInfo('🚀 Starting new MCP server instance...');
    return startNewServer(context);
}

async function startNewServer(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        const serverPath = getServerPath(context);
        
        if (!serverPath) {
            const errorMsg = 'MCP server not found. Please ensure the extension is properly installed.';
            logError('❌ ' + errorMsg);
            vscode.window.showErrorMessage(errorMsg);
            return false;
        }

        logInfo('🚀 Starting new MCP server instance at: ' + serverPath);
        
        // Get the correct workspace path to pass to MCP server
        const workspaceId = getWorkspaceId(context);
        logInfo(`🔍 Starting MCP server with workspace: ${workspaceId}`);

        mcpServerProcess = spawn('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                NODE_ENV: 'production',
                MCP_WORKSPACE: workspaceId,
                VSCODE_WORKSPACE: workspaceId
            }
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
            logError('❌ Failed to start MCP server automatically', error);
            mcpServerProcess = undefined;
            vscode.window.showErrorMessage(`Failed to start MCP server automatically: ${error.message}`);
        });

        // Wait a moment for the server to start
        logInfo('⏳ Waiting for MCP server to initialize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const success = mcpServerProcess !== undefined;
        if (success) {
            logInfo('✅ MCP server started successfully and ready for connections');
        } else {
            logError('❌ MCP server failed to start within timeout period');
        }
        
        return success;
    } catch (error) {
        const errorMsg = `Error starting MCP server automatically: ${error instanceof Error ? error.message : 'Unknown error'}`;
        logError('❌ ' + errorMsg);
        vscode.window.showErrorMessage(errorMsg);
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
    // Prevent overlapping connection attempts with mutex protection
    if (wsConnectionMutex) {
        logInfo('⚠️ WebSocket connection attempt blocked - connection operation already in progress');
        return;
    }

    wsConnectionMutex = true;
    
    try {
        const config = vscode.workspace.getConfiguration('interactiveMcp');
        const port = config.get<number>('serverPort') || 8547;
        const autoStartServer = config.get<boolean>('autoStartServer');
        const maxRetries = 3;

        logInfo(`Connection attempt ${retryCount + 1}/${maxRetries + 1} to shared router on port ${port}`);

        // Always cleanup existing connection first before validation
        if (wsClient) {
            logInfo('Cleaning up existing WebSocket connection before new attempt');
            await cleanupWebSocketConnection();
        }

        // Validate WebSocket state after cleanup
        if (!validateWebSocketState('connect')) {
            logInfo('⚠️ WebSocket connection aborted - invalid state for connection after cleanup');
            return;
        }

        // Try to start shared router if auto-start is enabled
        if (autoStartServer) {
            
            const routerStarted = await startSharedRouter(context);
            logInfo(`Router startup result: ${routerStarted ? 'success' : 'failed/already running'}`);
            
            if (!routerStarted) {
                // ensureRouterRunning will throw an error that gets caught by enableInteractiveMcp
                throw new Error('Failed to start Interactive MCP router');
            }
        }

        logInfo(`🔌 Creating WebSocket connection to ws://localhost:${port}`);
        logInfo(`🔍 Pre-connection diagnostics - Router process: ${routerProcess ? 'running' : 'not running'}, MCP server: ${mcpServerProcess ? 'running' : 'not running'}`);

        try {
            wsClient = new WebSocket(`ws://localhost:${port}`);
            logInfo('📡 WebSocket client created, waiting for connection...');
        } catch (error) {
            logError('❌ Failed to create WebSocket client', error);
            throw error; // Let enableInteractiveMcp handle the error
        }

        // Enhanced WebSocket event handlers with better error recovery
        setupWebSocketEventHandlers(context, retryCount, maxRetries);
        
    } catch (error) {
        logError('❌ Error in connectToMcpServer', error);
        throw error;
    } finally {
        // Always release the connection mutex
        wsConnectionMutex = false;
    }
}

// Validate WebSocket state before operations
function validateWebSocketState(operation: string): boolean {
    if (wsClient) {
        const state = wsClient.readyState;
        
        switch (operation) {
            case 'connect':
                // Only block if WebSocket is actually OPEN or CONNECTING
                // Allow connections when WebSocket is CLOSED or CLOSING (these are safe to replace)
                if (state === WebSocket.OPEN) {
                    logInfo(`⚠️ WebSocket already connected - ${operation} operation may cause race condition`);
                    return false;
                }
                if (state === WebSocket.CONNECTING) {
                    logInfo(`⚠️ WebSocket already connecting - ${operation} operation blocked`);
                    return false;
                }
                // CLOSED and CLOSING states are safe for new connections
                logInfo(`✅ WebSocket in ${getWebSocketStateString(state)} state - safe for new connection`);
                break;
                
            case 'send':
                if (state !== WebSocket.OPEN) {
                    logInfo(`⚠️ WebSocket not ready for sending (state: ${getWebSocketStateString(state)})`);
                    return false;
                }
                break;
                
            case 'close':
                if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
                    logInfo(`⚠️ WebSocket already closed/closing - ${operation} operation unnecessary`);
                    return false;
                }
                break;
        }
    }
    
    return true;
}

// Get human-readable WebSocket state string
function getWebSocketStateString(state: number): string {
    switch (state) {
        case WebSocket.CONNECTING: return 'CONNECTING';
        case WebSocket.OPEN: return 'OPEN';
        case WebSocket.CLOSING: return 'CLOSING';
        case WebSocket.CLOSED: return 'CLOSED';
        default: return 'UNKNOWN';
    }
}

// Enhanced WebSocket connection cleanup
async function cleanupWebSocketConnection(): Promise<void> {
    if (!wsClient) {
        return;
    }
    
    logInfo('🧹 Performing enhanced WebSocket cleanup...');
    
    // Reset wsClient immediately to prevent reuse
    const clientToCleanup = wsClient;
    wsClient = undefined;
    
    try {
        // Remove all listeners to prevent events during cleanup
        clientToCleanup.removeAllListeners();
        
        // Close connection if not already closed
        if (clientToCleanup.readyState === WebSocket.OPEN || clientToCleanup.readyState === WebSocket.CONNECTING) {
            clientToCleanup.close(1000, 'Clean shutdown');
            
            // Wait for close to complete with timeout
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    logInfo('⏰ WebSocket close timeout - forcing cleanup');
                    resolve();
                }, 2000);
                
                clientToCleanup.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                // If already closed, resolve immediately
                if (clientToCleanup.readyState === WebSocket.CLOSED) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        }
        
        logInfo('✅ WebSocket cleanup completed');
        
    } catch (error) {
        logError('❌ Error during WebSocket cleanup', error);
        // wsClient already set to undefined above, so cleanup is guaranteed
    }
    
    // Clear message queue since connection is gone
    clearMessageQueue();
}

// Critical cleanup after error to allow restart
async function cleanupAfterError(): Promise<void> {
    logInfo('🧹 Starting comprehensive cleanup after error...');
    
    try {
        // 1. Clean up WebSocket connection
        await cleanupWebSocketConnection();
        
        // 2. Clean up MCP server process
        if (mcpServerProcess) {
            logInfo('🔪 Terminating MCP server process after error...');
            try {
                mcpServerProcess.kill('SIGTERM');
                
                // Force kill if needed
                setTimeout(() => {
                    if (mcpServerProcess && !mcpServerProcess.killed) {
                        logInfo('🔪 Force killing MCP server after timeout');
                        mcpServerProcess.kill('SIGKILL');
                    }
                }, 2000);
                
                mcpServerProcess = undefined;
                logInfo('✅ MCP server process cleaned up');
            } catch (error) {
                logError('❌ Error cleaning up MCP server process', error);
                mcpServerProcess = undefined; // Force clear reference
            }
        }
        
        // 3. Clean up router process if we started it
        cleanupRouterProcess();
        
        // 4. Reset connection state
        wasConnectedBefore = false; // Reset reconnection tracking
        
        logInfo('✅ Comprehensive cleanup completed - ready for clean restart');
        
    } catch (error) {
        logError('❌ Error during comprehensive cleanup', error);
        // Force clear all references to ensure clean state
        wsClient = undefined;
        mcpServerProcess = undefined;
    }
}

// Setup WebSocket event handlers with enhanced error recovery
function setupWebSocketEventHandlers(context: vscode.ExtensionContext, retryCount: number, maxRetries: number) {
    if (!wsClient) {
        logError('❌ Cannot setup event handlers - WebSocket client is null');
        return;
    }

    wsClient.on('open', async () => {
        logInfo('🔗 WebSocket connection established with shared router');
        
        // Register with shared router
        workspaceId = getWorkspaceId(context);
        sessionId = `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        logInfo(`📝 Registering VS Code extension with router`);
        logInfo(`   WorkspaceId: ${workspaceId}`);
        logInfo(`   SessionId: ${sessionId}`);
        
        // Use robust message sending
        const registrationMessage = {
            type: 'register',
            clientType: 'vscode-extension',
            workspaceId,
            sessionId
        };
        
        if (sendWebSocketMessage(registrationMessage)) {
            logInfo('📤 Registration message sent to router');
            logInfo(`📊 Registration details: WorkspaceId=${workspaceId}, SessionId=${sessionId}`);
            // Notify state machine of successful router connection
            connectionStateMachine.handleRouterConnected();
            
            // Send workspace cleanup signal to remove any stale MCP servers for this workspace
            const cleanupMessage = {
                type: 'workspace-cleanup',
                workspaceId,
                sessionId,
                timestamp: Date.now()
            };

            if (sendWebSocketMessage(cleanupMessage)) {
                logInfo('🧹 Workspace cleanup signal sent to router');
            }

            // Send pairing-ready signal to trigger IDE MCP tool discovery
            const pairingReadyMessage = {
                type: 'pairing-ready',
                workspaceId,
                sessionId,
                isReconnection: wasConnectedBefore
            };

            if (sendWebSocketMessage(pairingReadyMessage)) {
                logInfo('📢 Pairing-ready signal sent to help IDE detect MCP tools');
            }
            
            // Process any queued messages now that connection is established
            await processMessageQueue();
            logInfo('✅ VS Code extension successfully connected to Interactive MCP router - coordinating workspace...');
        } else {
            logError('❌ Failed to send registration message - connection may be unstable');
            connectionStateMachine.handleError('Failed to register with router');
        }
    });

    wsClient.on('message', async (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'register') {
                logInfo('✅ Registration confirmed by router');
            } else if (message.type === 'heartbeat') {
                logDebug('💓 Heartbeat received from router');
            } else if (message.type === 'tools-available-heartbeat') {
                logInfo('💓 Tools-available heartbeat received - MCP tools are ready for IDE detection');
                // Show a brief status to help users understand pairing is in progress
                const currentState = connectionStateMachine.getCurrentState();
                if (currentState === 'CONNECTED') {
                    logInfo('🔄 Pairing in progress - tools should be detectable by IDE now');
                }
            } else if (message.type === 'tool-refresh-complete') {
                logInfo('✅ Tool refresh complete - MCP tools should now be detectable by IDE without manual toggle');
            } else if (message.type === 'workspace-sync-complete') {
                await handleWorkspaceSyncComplete(message);
            } else if (message.type === 'request') {
                // Handle tool requests - queue if still pairing
                const currentState = connectionStateMachine.getCurrentState();
                if (currentState === 'CONNECTED') {
                    // Still pairing - queue the request and send auto-retry signal
                    logInfo('📦 Request received during pairing - queueing and triggering auto-retry');
                    queueMessage(message);
                    
                    // Send auto-retry trigger to IDE to re-detect MCP tools
                    const retryTriggerMessage = {
                        type: 'auto-retry-trigger',
                        workspaceId,
                        sessionId,
                        reason: 'pairing-in-progress'
                    };
                    sendWebSocketMessage(retryTriggerMessage);
                    
                    // Also respond immediately with a pairing status
                    const pairingStatusResponse = {
                        type: 'response',
                        requestId: message.requestId,
                        response: {
                            type: 'pairing_status',
                            status: 'pairing',
                            message: 'Extension is still pairing with MCP server. Please wait...'
                        }
                    };
                    sendWebSocketMessage(pairingStatusResponse);
                } else {
                    // Ready to handle requests normally
                    await handleMcpRequest(message);
                }
            } else {
                logInfo(`📥 Received ${message.type} message from router`);
            }
        } catch (error) {
            logError('❌ Error handling message from router', error);
        }
    });

    wsClient.on('close', (code, reason) => {
        logInfo(`WebSocket disconnected from shared router (code: ${code}, reason: ${reason || 'unknown'})`);
        
        // Clear the wsClient reference - this is now handled in cleanup function
        // wsClient = undefined; // Removed - cleanup function handles this
        
        // Clear message queue since connection is lost
        clearMessageQueue();
        
        // Determine disconnection type
        const isNormalClosure = code === 1000;
        const isGoingAway = code === 1001;
        
        if (isNormalClosure || isGoingAway) {
            // Normal disconnection - go to disconnected state
            logInfo('✅ Normal disconnection from router - transitioning to DISCONNECTED');
            connectionStateMachine.transition('DISCONNECTED');
        } else {
            // Unexpected disconnection - this is an error
            logInfo(`❌ Unexpected disconnection (code: ${code}) - transitioning to ERROR state`);
            connectionStateMachine.handleError(`Connection lost (code: ${code})`);
            
            // Enhanced auto-reconnect with exponential backoff
            const config = vscode.workspace.getConfiguration('interactiveMcp');
            if (config.get<boolean>('autoConnect') && retryCount === 0) {
                const reconnectDelay = Math.min(3000 * Math.pow(1.5, retryCount), 10000);
                logInfo(`🔄 Attempting automatic reconnection in ${reconnectDelay}ms...`);
                setTimeout(() => {
                    enableInteractiveMcp(context);
                }, reconnectDelay);
            }
        }
    });

    wsClient.on('error', (error: Error) => {
        logError('❌ WebSocket connection error', error);
        
        // Clear wsClient reference on error to prevent stale state
        wsClient = undefined;
        
        // Enhanced retry logic with exponential backoff
        if (retryCount < maxRetries) {
            const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
            logInfo(`🔄 Connection failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            
            setTimeout(() => {
                connectToMcpServer(context, retryCount + 1);
            }, retryDelay);
        } else {
            logError('❌ Max connection retries exceeded');
            const errorMessage = `Connection failed after ${maxRetries + 1} attempts: ${error.message || 'Unknown error'}`;
            connectionStateMachine.handleError(errorMessage);
        }
    });
}

async function disconnectFromMcpServer() {
    logInfo('🔌 Disconnecting from MCP server...');
    
    // Prevent concurrent disconnect operations
    if (wsConnectionMutex) {
        logInfo('⚠️ Disconnect blocked - connection operation in progress, waiting...');
        // Wait for current operation to complete
        while (wsConnectionMutex) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    wsConnectionMutex = true;
    
    try {
        await cleanupWebSocketConnection();
        logInfo('✅ Disconnection completed successfully');
    } catch (error) {
        logError('❌ Error during disconnection', error);
    } finally {
        wsConnectionMutex = false;
    }
}

// Track if this is a manual reconnection (after being previously connected)
let wasConnectedBefore = false;

// New simplified enable function - uses state machine for reliability
async function enableInteractiveMcp(context: vscode.ExtensionContext) {
    logInfo('🚀 Enabling Interactive MCP tools...');

    // Log system information for debugging
    const config = vscode.workspace.getConfiguration('interactiveMcp');
    const port = config.get<number>('serverPort') || 8547;
    const autoStartServer = config.get<boolean>('autoStartServer');
    logInfo(`⚙️ Configuration - Port: ${port}, Auto-start: ${autoStartServer}`);

    // Detect if this is a manual reconnection
    const isManualReconnection = wasConnectedBefore;
    if (isManualReconnection) {
        logInfo('🔄 Detected manual reconnection - will use aggressive tool refresh');
    }
    logInfo(`📊 Connection attempt - Manual: ${isManualReconnection}, Current state: ${connectionStateMachine.getCurrentState()}`);
    
    // Check if state machine allows enable
    if (!connectionStateMachine.handleEnable()) {
        logInfo('Enable request ignored - not in correct state or operation in progress');
        return;
    }
    
    try {
        // Step 0: Only clean up WebSocket connections, not processes
        if (isManualReconnection) {
            logInfo('🧹 Cleaning up WebSocket connections before reconnection...');
            await cleanupWebSocketConnection();
            // Brief pause to ensure cleanup completes
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Step 1: Ensure router is running (this handles port conflicts)
        await ensureRouterRunning(context);
        
        // Step 2: Connect to router first, then start MCP server
        logInfo('🔌 Connecting to router first to ensure coordination...');
        await connectToMcpServer(context, 0);

        // Step 3: Start MCP server after VS Code extension is registered
        logInfo('🔧 Starting MCP server after VS Code extension registration...');
        const mcpServerStarted = await startLocalMcpServer(context);
        if (!mcpServerStarted) {
            throw new Error('Failed to start MCP server automatically - check if another instance is running');
        }
        logInfo('✅ MCP server started successfully and ready for coordination');

        // Step 4: Wait for workspace coordination to complete
        logInfo('⏳ Waiting for workspace coordination to complete...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        logInfo('✅ Interactive MCP tools enabled successfully');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logError('❌ Failed to enable Interactive MCP tools', error);
        connectionStateMachine.handleError(errorMessage);
    } finally {
        // Always release the operation lock
        connectionStateMachine.releaseOperationLock();
    }
}

// New simplified disable function - uses state machine for reliability
function disableInteractiveMcp() {
    logInfo('🛑 Disabling Interactive MCP tools...');
    
    // Check if state machine allows disable
    if (!connectionStateMachine.handleDisable()) {
        logInfo('Disable request ignored - not in correct state or operation in progress');
        return;
    }
    
    try {
        // Send disconnection signal to help IDE clear tool cache
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
            const disconnectionMessage = {
                type: 'manual-disconnection',
                workspaceId,
                sessionId,
                timestamp: Date.now()
            };
            
            try {
                wsClient.send(JSON.stringify(disconnectionMessage));
                logInfo('📤 Sent manual disconnection signal to clear IDE cache');
            } catch (error) {
                // Ignore send errors during disconnection
            }
        }
        
        // Disconnect from router
        disconnectFromMcpServer();
        
        logInfo('✅ Interactive MCP tools disabled');
    } finally {
        // Always release the operation lock
        connectionStateMachine.releaseOperationLock();
    }
}

// Ensure router is running with robust port management and mutex protection
async function ensureRouterRunning(context: vscode.ExtensionContext): Promise<void> {
    logInfo('🔧 Ensuring router is running...');
    
    // Prevent concurrent router startup attempts across all IDE instances
    if (routerStartupMutex) {
        logInfo('⚠️ Router startup already in progress, waiting...');
        // Wait for current startup to complete
        while (routerStartupMutex) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Check if router is now running
        const config = vscode.workspace.getConfiguration("interactiveMcp");
        const port = config.get<number>("serverPort") || 8547;
        const isRunning = await testIfOurRouter(port);
        
        if (isRunning) {
            logInfo('✅ Router started by concurrent process - proceeding');
            return;
        }
        
        logInfo('⚠️ Concurrent startup failed, attempting our own startup...');
    }
    
    // Acquire mutex
    routerStartupMutex = true;
    
    try {
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
    } finally {
        // Always release mutex
        routerStartupMutex = false;
    }
}

async function handleWorkspaceSyncComplete(message: any) {
    const { finalWorkspace, mcpSessionId, vscodeSessionId } = message;
    
    logInfo(`🎉 Workspace coordination complete! Final workspace: ${finalWorkspace}`);
    logInfo(`🔗 Now paired with MCP server session: ${mcpSessionId}`);
    logInfo(`📊 Coordination details: VSCode=${vscodeSessionId}, MCP=${mcpSessionId}`);
    
    // Update our workspace ID if needed
    workspaceId = finalWorkspace;
    
    // Notify state machine of successful pairing
    connectionStateMachine.handleWorkspacePaired();
    
    // Mark that we've been connected before (for reconnection detection)
    wasConnectedBefore = true;
    
    // Process any remaining queued messages now that we're fully ready
    await processMessageQueue();

    logInfo('✅ Interactive MCP tools are now fully operational with workspace coordination complete');
}


async function handleMcpRequest(message: any) {
    if (message.type === 'request') {
        logInfo(`📥 Received ${message.inputType} request`);
        
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

        // Send response back to MCP server using robust message sending
        const responseMessage = {
            type: 'response',
            requestId: message.requestId,
            response: response
        };
        
        if (!sendWebSocketMessage(responseMessage)) {
            logError('❌ Failed to send response to MCP server');
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
                text-align: left;
                animation: slideIn 0.2s ease-out, glow 3s ease-in-out infinite;
            }
            
            /* Add specific list styling */
            ul, ol {
                padding-left: 20px;
                margin: 10px 0;
            }

            li {
                margin-bottom: 5px;
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
            
            /* Code block styling */
            pre {
                background: transparent;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                white-space: pre;
                word-wrap: normal;
                border: 1px solid ${borderColor};
            }

            code {
                font-family: monospace;
                font-size: 13px;
                background: transparent;  /* Transparent for inline code */
                padding: 2px 4px;  /* Slight padding for visibility */
                border-radius: 3px;
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
                <div class="dialog-message">${renderMarkdown(options.message)}</div>
                
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
                    text-align: left;  /* Changed to left */
                }
                
                /* Add list styling */
                ul, ol {
                    padding-left: 20px;
                    margin: 10px 0;
                }

                li {
                    margin-bottom: 5px;
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

                /* Code block styling */
                pre {
                    background: transparent;
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                    white-space: pre;
                    word-wrap: normal;
                    border: 1px solid ${borderColor};
                }

                code {
                    font-family: monospace;
                    font-size: 13px;
                    background: transparent;
                    padding: 2px 4px;
                    border-radius: 3px;
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
                <div class="message">${renderMarkdown(options.message)}</div>
                
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
                    text-align: left;  /* Changed to left */
                }
                
                /* Add list styling */
                ul, ol {
                    padding-left: 20px;
                    margin: 10px 0;
                }

                li {
                    margin-bottom: 5px;
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

                /* Code block styling */
                pre {
                    background: transparent;
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                    white-space: pre;
                    word-wrap: normal;
                    border: 1px solid ${borderColor};
                }

                code {
                    font-family: monospace;
                    font-size: 13px;
                    background: transparent;
                    padding: 2px 4px;
                    border-radius: 3px;
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
                <div class="prompt">${renderMarkdown(options.prompt)}</div>
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

function renderMarkdown(md: string): string {
  // Helper to escape HTML
  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // First, extract multiline code blocks to protect them
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let codeBlocks: string[] = [];
  let placeholderIndex = 0;
  md = md.replace(codeBlockRegex, (match, p1) => {
    codeBlocks.push(`<pre><code>${escapeHtml(p1.trim())}</code></pre>`);
    return `{{CODEBLOCK_${placeholderIndex++}}}`;
  });

  // Now process lines for other Markdown
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listType = '';
  lines.forEach(line => {
    let processed = escapeHtml(line);  // Escape first
    // Headers
    const headerMatch = processed.match(/^#{1,6}\s+/);
    if (headerMatch) {
      const level = headerMatch[0].match(/^#+/)![0].length;
      const content = processed.replace(/^#{1,6}\s+/, '');
      html += `<h${level}>${content}</h${level}>`;
      return;
    }
    // Lists...
    // (keep existing list logic)
    // Inline elements on non-list lines
    if (!inList) {
      processed = processed.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
      processed = processed.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
      processed = processed.replace(/`([^`]+)`/g, (match, p1) => `<code>${escapeHtml(p1)}</code>`);  // Escape inside inline code
      processed = processed.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
      processed = processed.replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2" />');
    }
    html += processed + '<br>';
  });
  if (inList) html += `</${listType}>`;

  // Restore code blocks
  html = html.replace(/{{CODEBLOCK_(\d+)}}/g, (match, index) => codeBlocks[parseInt(index)]);

  return html;
}

// Enhanced router cleanup function
function cleanupRouterProcess(): void {
    if (routerProcess) {
        logInfo('🧹 Cleaning up router process...');
        try {
            // Try graceful termination first
            routerProcess.kill('SIGTERM');
            
            // Force kill after 3 seconds if graceful termination fails
            const forceKillTimeout = setTimeout(() => {
                if (routerProcess) {
                    logInfo('🔪 Force killing router process after timeout');
                    try {
                        routerProcess.kill('SIGKILL');
                    } catch (error) {
                        logError('Error force killing router process', error);
                    }
                    routerProcess = undefined;
                }
            }, 3000);
            
            // Clear timeout if process exits gracefully
            routerProcess.once('exit', () => {
                clearTimeout(forceKillTimeout);
                logInfo('✅ Router process cleaned up successfully');
            });
            
        } catch (error) {
            logError('Error during router cleanup', error);
            routerProcess = undefined;
        }
    }
}

export function deactivate() {
    logInfo('🛑 Extension deactivating - cleaning up resources...');
    
    // Release router startup mutex
    routerStartupMutex = false;
    
    if (wsClient) {
        try {
            cleanupWebSocketConnection().catch(error => {
                logError('Error during WebSocket cleanup in deactivate', error);
            });
        } catch (error) {
            logError('Error during WebSocket cleanup in deactivate', error);
        }
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    
    // Enhanced router process cleanup
    cleanupRouterProcess();
    
    logInfo('✅ Extension deactivation complete');
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
  chimeToggleItem.tooltip = enabled ? 'Interactive MCP Chime is ON' : 'Interactive MCP Chime is OFF';
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
        const workspaceId = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath);
        logDebug(`🔍 Using workspace folder: ${workspaceId}`);
        return workspaceId;
    }

    // Try workspace file if available
    if (vscode.workspace.workspaceFile) {
        const workspaceId = path.resolve(vscode.workspace.workspaceFile.fsPath);
        logDebug(`🔍 Using workspace file: ${workspaceId}`);
        return workspaceId;
    }

    // Fallback to extension path (this shouldnt happen in normal usage)
    const fallbackId = path.resolve(context.extensionPath);
    logInfo(`⚠️ Using fallback workspace ID (extension path): ${fallbackId}`);
    logInfo(`⚠️ This indicates no workspace folder is open in VS Code`);
    return fallbackId;
}

// Start shared router with enhanced multi-instance detection and error handling
async function startSharedRouter(context: vscode.ExtensionContext): Promise<boolean> {
    logInfo('🚀 Starting shared router with enhanced multi-instance detection...');
    
    if (routerProcess) {
        logInfo("✅ Router process already running in this instance");
        return true;
    }

    const config = vscode.workspace.getConfiguration("interactiveMcp");
    const port = config.get<number>("serverPort") || 8547;
    
    logInfo(`🔍 Performing enhanced port check and router startup on port ${port}...`);
    
    // Enhanced atomic operation: check port and start router with better detection
    let processInfo = await getProcessUsingPort(port);
    
    if (processInfo) {
        logInfo(`⚠️ Port ${port} is occupied by PID ${processInfo.pid}`);
        
        // Test if existing process is our router
        logInfo(`🔍 Testing if existing process is our router...`);
        const isOurRouter = await testIfOurRouter(port);

        if (isOurRouter) {
            logInfo(`✅ Port ${port} has our Interactive MCP router running - using existing instance`);
            logInfo(`🔗 Multi-instance support: Successfully connected to existing router`);
            return true;
        } else {
            logInfo(`❓ Port ${port} is occupied by unknown process - will attempt to use different approach`);

            // Instead of killing the process, let's try to start our router and let it handle the conflict
            logInfo(`🔄 Attempting to start router anyway - it will handle port conflicts gracefully`);
            return await startNewRouter(context, port);
        }
    } else {
        logInfo(`✅ Port ${port} is free and available for router startup`);
        return await startNewRouter(context, port);
    }
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
            if (output.includes("EADDRINUSE") || output.includes("Port is already in use")) {
                logError("❌ Port conflict detected in router stderr - another router instance is running");
                // Don't immediately kill the process, let the health check handle it
            }
        });

        routerProcess.on("close", (code) => {
            logInfo(`Router exited with code ${code}`);

            // Enhanced cleanup on router process termination
            if (code !== 0 && code !== null) {
                if (code === 1) {
                    logInfo(`🔄 Router exited with code 1 - likely port conflict, checking if existing router is available`);
                    // This is expected when another router is already running
                } else {
                    logError(`❌ Router process exited unexpectedly with code ${code}`);
                }
            }

            routerProcess = undefined;
        });

        routerProcess.on("error", (error) => {
            logError("Failed to start router", error);
            // Ensure proper cleanup on router startup failure
            if (routerProcess) {
                try {
                    routerProcess.kill('SIGTERM');
                    // Force kill after 2 seconds if graceful termination fails
                    setTimeout(() => {
                        if (routerProcess) {
                            logInfo('🔪 Force killing unresponsive router process');
                            routerProcess.kill('SIGKILL');
                        }
                    }, 2000);
                } catch (killError) {
                    logError('Error during router process cleanup', killError);
                }
                routerProcess = undefined;
            }
        });

        // Use adaptive health check instead of fixed delay
        logInfo('🏥 Performing health check for router startup...');

        if (routerProcess) {
            const isHealthy = await waitForRouterHealth(port, 8000); // 8 second max wait

            if (isHealthy) {
                logInfo(`✅ Router successfully started and responding on port ${port}`);
                const workspaceId = getWorkspaceId(context);
                logInfo(`📁 Workspace: ${workspaceId}`);
                logInfo(`🎯 Router startup complete - ready for connections`);
                return true;
            } else {
                logInfo('⚠️ Router process running but health check failed - may still be starting');
                // Don't kill the process immediately, it might still be starting up
                // Let the connection logic handle this gracefully
                return true; // Return true to allow connection attempts
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

// Check what process is using a port with enhanced error handling
async function getProcessUsingPort(port: number): Promise<{ pid: number; command: string } | null> {
    return new Promise((resolve) => {
        // Try different commands based on platform
        const isWindows = process.platform === 'win32';
        const command = isWindows
            ? `netstat -ano | findstr :${port}`
            : `lsof -ti:${port} 2>/dev/null || ss -tlnp | grep :${port}`;
        
        logDebug(`🔍 Checking port ${port} with command: ${command}`);
        
        const { spawn } = require('child_process');
        const proc = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        
        let output = '';
        let errorOutput = '';
        
        proc.stdout.on('data', (data: Buffer) => {
            output += data.toString();
        });
        
        proc.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
        });
        
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
            logDebug(`⏰ Port check timed out for port ${port}`);
            proc.kill();
            resolve(null);
        }, 5000);
        
        proc.on('close', (code: number | null) => {
            clearTimeout(timeout);
            
            if (code !== 0 && errorOutput) {
                logDebug(`Port check command failed with code ${code}: ${errorOutput}`);
            }
            
            if (!output.trim()) {
                logDebug(`✅ Port ${port} is free`);
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
                            logDebug(`🔍 Port ${port} occupied by PID ${pid}`);
                            resolve({ pid, command: 'unknown' });
                            return;
                        }
                    }
                } else {
                    // Parse Unix lsof/ss output
                    const pid = parseInt(output.trim().split('\n')[0]);
                    if (!isNaN(pid)) {
                        logDebug(`🔍 Port ${port} occupied by PID ${pid}`);
                        resolve({ pid, command: 'unknown' });
                        return;
                    }
                }
            } catch (error) {
                logDebug('Error parsing port check output: ' + error);
            }
            
            logDebug(`❓ Could not determine port ${port} status from output: ${output}`);
            resolve(null);
        });
        
        proc.on('error', (error: Error) => {
            clearTimeout(timeout);
            logDebug(`Port check command error: ${error.message}`);
            resolve(null);
        });
    });
}

// Kill a process by PID
async function killProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const command = isWindows ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
        
        const { spawn } = require('child_process');
        const proc = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        
        proc.on('close', (code: number | null) => {
            resolve(code === 0);
        });
        
        proc.on('error', () => resolve(false));
    });
}

// Test if an existing WebSocket server is our router - Simplified for reliability
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
                    try {
                        if (testSocket.readyState === WebSocket.OPEN || testSocket.readyState === WebSocket.CONNECTING) {
                            testSocket.close();
                        }
                    } catch (error) {
                        // Ignore cleanup errors
                    }
                }
            };

            testSocket.on("open", () => {
                logInfo(`📡 Connected to port ${port}, waiting for router identification...`);
                // Our router sends heartbeat immediately on connection
                // Give it a reasonable time to respond
            });
            
            testSocket.on("message", (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    logInfo(`📥 Received message from port ${port}: ${message.type}`);

                    // Any valid JSON message from our router protocol confirms it's ours
                    if (message.type === 'heartbeat' || message.type === 'register' || message.type === 'response') {
                        logInfo(`✅ Port ${port} confirmed as our Interactive MCP router`);
                        cleanup();
                        resolve(true);
                    } else {
                        logInfo(`❓ Port ${port} sent unknown message type: ${message.type}`);
                        cleanup();
                        resolve(false);
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
            
            testSocket.on("close", (code: number, reason: Buffer) => {
                const reasonStr = reason.toString();
                logInfo(`🔌 Connection to port ${port} closed during test (code: ${code}, reason: ${reasonStr})`);
                if (!resolved) {
                    cleanup();
                    // If connection closed immediately, it might not be our router
                    resolve(false);
                }
            });
            
            // Reasonable timeout for router detection
            setTimeout(() => {
                if (!resolved) {
                    logInfo(`⏰ Port ${port} test timed out after 2 seconds - not our router`);
                    cleanup();
                    resolve(false);
                }
            }, 2000);
        } catch (error) {
            logError(`❌ Error testing port ${port}`, error);
            resolve(false);
        }
    });
}

// Adaptive health check that polls router readiness with exponential backoff
async function waitForRouterHealth(port: number, maxWaitMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    let attempt = 0;
    const maxAttempts = 20;
    
    logInfo(`🏥 Starting adaptive health check for router on port ${port}...`);
    
    while (Date.now() - startTime < maxWaitMs && attempt < maxAttempts) {
        attempt++;
        const delay = Math.min(100 * Math.pow(1.5, attempt - 1), 1000); // Exponential backoff, max 1s
        
        logDebug(`🔍 Health check attempt ${attempt}/${maxAttempts} (delay: ${delay}ms)`);
        
        const isHealthy = await testRouterConnection(port);
        if (isHealthy) {
            const elapsed = Date.now() - startTime;
            logInfo(`✅ Router health confirmed after ${elapsed}ms (${attempt} attempts)`);
            return true;
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const elapsed = Date.now() - startTime;
    logError(`❌ Router health check failed after ${elapsed}ms (${attempt} attempts)`);
    return false;
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
