#!/usr/bin/env node

/**
 * Test script to verify the HTTP transport is working
 */

import fetch from 'node-fetch';

const MCP_URL = 'http://localhost:8090/mcp';

async function testHttpTransport() {
  console.log('🧪 Testing MCP HTTP Transport...');
  console.log(`📡 Connecting to: ${MCP_URL}`);

  try {
    // Test 1: Initialize the MCP server
    console.log('\n1️⃣ Testing initialization...');
    const initResponse = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      })
    });

    if (!initResponse.ok) {
      throw new Error(`HTTP ${initResponse.status}: ${initResponse.statusText}`);
    }

    const initResult = await initResponse.json();
    console.log('✅ Initialization successful:', JSON.stringify(initResult, null, 2));

    const sessionId = initResponse.headers.get('Mcp-Session-Id');
    console.log(`🆔 Session ID: ${sessionId}`);

    // Test 2: List available tools
    console.log('\n2️⃣ Testing tools/list...');
    const toolsResponse = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(sessionId && { 'Mcp-Session-Id': sessionId })
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      })
    });

    if (!toolsResponse.ok) {
      throw new Error(`HTTP ${toolsResponse.status}: ${toolsResponse.statusText}`);
    }

    const toolsResult = await toolsResponse.json();
    console.log('✅ Tools list successful:');
    toolsResult.result.tools.forEach(tool => {
      console.log(`   📋 ${tool.name} (${tool.title}): ${tool.description.substring(0, 80)}...`);
    });

    // Test 3: Test a tool call (this will fail without VS Code extension, but should show proper error)
    console.log('\n3️⃣ Testing tools/call (expect error without VS Code)...');
    const callResponse = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(sessionId && { 'Mcp-Session-Id': sessionId })
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'ask_user_buttons',
          arguments: {
            title: 'Test Question',
            message: 'This is a test message',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' }
            ]
          }
        }
      })
    });

    const callResult = await callResponse.json();
    if (callResult.error) {
      console.log('⚠️ Tool call failed as expected (VS Code extension not connected):');
      console.log(`   Error: ${callResult.error.message}`);
    } else {
      console.log('✅ Tool call successful:', JSON.stringify(callResult, null, 2));
    }

    console.log('\n🎉 HTTP Transport test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   ✅ HTTP server is responding');
    console.log('   ✅ MCP protocol initialization works');
    console.log('   ✅ Tools are properly listed');
    console.log('   ✅ Tool calls are handled (require VS Code extension for actual execution)');
    console.log('\n🔗 Your MCP configuration should be:');
    console.log(JSON.stringify({
      mcpServers: {
        "interactive-mcp": {
          url: "http://localhost:8090/mcp"
        }
      }
    }, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('   1. Make sure the VS Code extension is installed and activated');
    console.log('   2. Check that the MCP server is running in HTTP mode');
    console.log('   3. Verify the port 8090 is not blocked by firewall');
    process.exit(1);
  }
}

// Run the test
testHttpTransport().catch(console.error);