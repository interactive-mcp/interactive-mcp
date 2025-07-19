#!/bin/bash

# Interactive MCP Extension - Complete Build Script
# This script builds everything needed for the VS Code extension

set -e  # Exit on any error

echo "🚀 Starting Interactive MCP Extension Build Process..."
echo "=================================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}🔄 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we're in the right directory
if [ ! -d "interactive-mcp-server" ] || [ ! -d "interactive-vscode-extension" ]; then
    print_error "Please run this script from the root directory containing both 'interactive-mcp-server' and 'interactive-vscode-extension' folders"
    exit 1
fi

# Step 1: Build MCP Server
print_step "Building MCP Server..."
cd interactive-mcp-server

if [ ! -f "package.json" ]; then
    print_error "package.json not found in interactive-mcp-server directory"
    exit 1
fi

print_step "Installing MCP server dependencies..."
npm install

print_step "Building MCP server TypeScript..."
npm run build

print_success "MCP Server built successfully"
cd ..

# Step 2: Build VS Code Extension
print_step "Building VS Code Extension..."
cd interactive-vscode-extension

if [ ! -f "package.json" ]; then
    print_error "package.json not found in interactive-vscode-extension directory"
    exit 1
fi

print_step "Installing VS Code extension dependencies..."
npm install

print_step "Bundling MCP server and shared router into extension..."
npm run bundle-all

print_step "Compiling VS Code extension TypeScript..."
npm run compile

print_step "Packaging extension into VSIX file..."
npm run package

# Find the VSIX file
VSIX_FILE=$(find . -name "*.vsix" -type f | head -1)

if [ -n "$VSIX_FILE" ]; then
    print_success "Extension packaged successfully!"
    echo ""
    echo "📦 VSIX File Location: $(realpath "$VSIX_FILE")"
    echo ""
    echo "🎯 To install manually:"
    echo "   1. Open VS Code"
    echo "   2. Go to Extensions (Ctrl+Shift+X)"
    echo "   3. Click the '...' menu"
    echo "   4. Select 'Install from VSIX...'"
    echo "   5. Choose: $(realpath "$VSIX_FILE")"
    echo ""
    echo "🔄 To reinstall (if already installed):"
    echo "   1. Uninstall the current version first"
    echo "   2. Then follow the installation steps above"
else
    print_error "VSIX file not found! Package command may have failed."
    exit 1
fi

cd ..

print_success "Build process completed successfully!"
echo ""
echo "📋 Summary:"
echo "   ✅ MCP Server built"
echo "   ✅ VS Code Extension compiled"
echo "   ✅ Server bundled into extension"
echo "   ✅ VSIX package created"
echo ""
print_warning "Note: Manual installation required - automatic installation was skipped"