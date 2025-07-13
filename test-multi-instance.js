#!/usr/bin/env node

/**
 * Test script for multi-instance Interactive MCP support
 * 
 * This script simulates multiple Claude Desktop instances running
 * with different workspace contexts to test the shared router.
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const ROUTER_PORT = 8547;
const TEST_WORKSPACES = [
    '/mnt/c/Users/razie/Desktop/My_MCP/workspace-a',
    '/mnt/c/Users/razie/Desktop/My_MCP/workspace-b'
];

let routerProcess;
let mcpProcesses = [];

// Create test workspace directories
function createTestWorkspaces() {
    const fs = require('fs');
    
    TEST_WORKSPACES.forEach(workspace => {
        if (!fs.existsSync(workspace)) {
            fs.mkdirSync(workspace, { recursive: true });
            fs.writeFileSync(path.join(workspace, 'test.txt'), `Test file for ${path.basename(workspace)}`);
            console.log(`📁 Created test workspace: ${workspace}`);
        }
    });
}

// Start the shared router
function startRouter() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting shared router...');
        
        const routerPath = path.join(__dirname, 'shared-router/dist/router.js');
        routerProcess = spawn('node', [routerPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PORT: ROUTER_PORT }
        });
        
        routerProcess.stdout.on('data', (data) => {
            console.log(`[Router] ${data.toString().trim()}`);
        });
        
        routerProcess.stderr.on('data', (data) => {
            console.error(`[Router Error] ${data.toString().trim()}`);
        });
        
        routerProcess.on('error', (error) => {
            console.error('Failed to start router:', error);
            reject(error);
        });
        
        // Wait a moment for router to start
        setTimeout(() => {
            console.log('✅ Router should be running on port', ROUTER_PORT);
            resolve();
        }, 2000);
    });
}

// Start an MCP server instance for a specific workspace
function startMcpServer(workspace, instanceId) {
    return new Promise((resolve, reject) => {
        console.log(`🔌 Starting MCP server ${instanceId} for workspace: ${workspace}`);
        
        const serverPath = path.join(__dirname, 'interactive-mcp-server/dist/index.js');
        const mcpProcess = spawn('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: workspace, // Set working directory to the workspace
            env: { 
                ...process.env, 
                MCP_WORKSPACE: workspace,
                MCP_ROUTER_PORT: ROUTER_PORT 
            }
        });
        
        mcpProcess.stdout.on('data', (data) => {
            console.log(`[MCP-${instanceId}] ${data.toString().trim()}`);
        });
        
        mcpProcess.stderr.on('data', (data) => {
            console.error(`[MCP-${instanceId} Error] ${data.toString().trim()}`);
        });
        
        mcpProcess.on('error', (error) => {
            console.error(`Failed to start MCP server ${instanceId}:`, error);
            reject(error);
        });
        
        mcpProcesses.push({ process: mcpProcess, workspace, instanceId });
        
        // Wait a moment for MCP server to connect
        setTimeout(() => {
            console.log(`✅ MCP server ${instanceId} should be connected`);
            resolve();
        }, 3000);
    });
}

// Test VS Code extension simulation
function simulateVSCodeExtension(workspace, instanceId) {
    return new Promise((resolve, reject) => {
        console.log(`📱 Simulating VS Code extension ${instanceId} for workspace: ${workspace}`);
        
        const ws = new WebSocket(`ws://localhost:${ROUTER_PORT}`);
        
        ws.on('open', () => {
            console.log(`[VSCode-${instanceId}] Connected to router`);
            
            // Register with router
            ws.send(JSON.stringify({
                type: 'register',
                clientType: 'vscode-extension',
                workspaceId: workspace,
                sessionId: `vscode-test-${instanceId}`
            }));
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            console.log(`[VSCode-${instanceId}] Received:`, message.type, message.requestId || '');
            
            if (message.type === 'request') {
                // Simulate user clicking a button after a delay
                setTimeout(() => {
                    console.log(`[VSCode-${instanceId}] Simulating user response`);
                    ws.send(JSON.stringify({
                        type: 'response',
                        requestId: message.requestId,
                        response: { value: `Response from workspace ${path.basename(workspace)}` }
                    }));
                }, 1000);
            }
        });
        
        ws.on('error', (error) => {
            console.error(`[VSCode-${instanceId}] Error:`, error);
            reject(error);
        });
        
        resolve(ws);
    });
}

// Test router statistics
function checkRouterStats() {
    const ws = new WebSocket(`ws://localhost:${ROUTER_PORT}`);
    
    ws.on('open', () => {
        console.log('📊 Checking router statistics...');
        ws.close();
    });
    
    ws.on('error', (error) => {
        console.error('❌ Router connection failed:', error.message);
    });
}

// Main test function
async function runTest() {
    try {
        console.log('🧪 Starting Multi-Instance Interactive MCP Test\n');
        
        // Create test workspaces
        createTestWorkspaces();
        
        // Start shared router
        await startRouter();
        
        // Start MCP servers for different workspaces
        await startMcpServer(TEST_WORKSPACES[0], 'A');
        await startMcpServer(TEST_WORKSPACES[1], 'B');
        
        // Simulate VS Code extensions
        const vscode1 = await simulateVSCodeExtension(TEST_WORKSPACES[0], 'A');
        const vscode2 = await simulateVSCodeExtension(TEST_WORKSPACES[1], 'B');
        
        // Check router stats
        setTimeout(() => checkRouterStats(), 1000);
        
        console.log('\n✅ Multi-instance test setup complete!');
        console.log('🔍 The system should now route requests correctly between instances.');
        console.log('📝 Check the logs above to verify workspace-specific routing.\n');
        
        // Keep running for manual testing
        console.log('Press Ctrl+C to stop the test...');
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down test...');
            
            // Close WebSocket connections
            if (vscode1) vscode1.close();
            if (vscode2) vscode2.close();
            
            // Kill MCP processes
            mcpProcesses.forEach(({ process, instanceId }) => {
                console.log(`🔌 Stopping MCP server ${instanceId}`);
                process.kill();
            });
            
            // Kill router
            if (routerProcess) {
                console.log('🚀 Stopping shared router');
                routerProcess.kill();
            }
            
            console.log('✅ Test cleanup complete');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    runTest();
}

module.exports = { runTest, createTestWorkspaces };