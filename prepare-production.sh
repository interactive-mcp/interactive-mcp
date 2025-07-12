#!/bin/bash

# 🚀 Interactive MCP Production Preparation Script
# This script helps prepare your Interactive MCP system for production deployment

set -e  # Exit on any error

echo "🚀 Interactive MCP Production Preparation"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
    echo -e "${BLUE}📋 $1${NC}"
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

# Check prerequisites
print_step "Checking prerequisites..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_success "Node.js and npm are installed"

# Check if we're in the right directory
if [ ! -d "interactive-vscode-extension" ] || [ ! -d "interactive-mcp-server" ]; then
    print_error "Please run this script from the root directory containing both interactive-vscode-extension and interactive-mcp-server folders"
    exit 1
fi

print_success "Project structure verified"

# Install VSCE if not already installed
print_step "Installing VS Code Extension Manager (VSCE)..."
if ! command -v vsce &> /dev/null; then
    npm install -g @vscode/vsce
    print_success "VSCE installed"
else
    print_success "VSCE already installed"
fi

# Prepare VS Code Extension
print_step "Preparing VS Code Extension..."

cd interactive-vscode-extension

# Install dependencies
print_step "Installing extension dependencies..."
npm install

# Compile TypeScript
print_step "Compiling TypeScript..."
npm run compile

# Run linting
print_step "Running ESLint..."
npm run lint

# Package extension
print_step "Packaging extension..."
npm run package

print_success "VS Code extension prepared successfully!"

# Get extension details
EXTENSION_NAME=$(node -p "require('./package.json').name")
EXTENSION_VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher || 'your-publisher-name'")

echo ""
print_success "Extension Details:"
echo "  📦 Name: $EXTENSION_NAME"
echo "  🏷️  Version: $EXTENSION_VERSION"
echo "  👤 Publisher: $PUBLISHER"
echo "  📄 Package: ${EXTENSION_NAME}-${EXTENSION_VERSION}.vsix"

cd ..

# Prepare MCP Server
print_step "Preparing MCP Server..."

cd interactive-mcp-server

# Install dependencies
print_step "Installing server dependencies..."
npm install

# Build TypeScript
print_step "Building server..."
npm run build

print_success "MCP server prepared successfully!"

# Get server details
SERVER_NAME=$(node -p "require('./package.json').name")
SERVER_VERSION=$(node -p "require('./package.json').version")

echo ""
print_success "Server Details:"
echo "  📦 Name: $SERVER_NAME"
echo "  🏷️  Version: $SERVER_VERSION"

cd ..

# Create deployment checklist
print_step "Creating deployment checklist..."

cat > DEPLOYMENT_CHECKLIST.md << EOF
# 🚀 Deployment Checklist

## Pre-Deployment
- [ ] Update package.json with your publisher details
- [ ] Add proper repository URLs
- [ ] Create icon and banner images
- [ ] Test extension thoroughly
- [ ] Write comprehensive documentation

## VS Code Extension Deployment
- [ ] Create Microsoft/Azure DevOps account
- [ ] Generate Personal Access Token
- [ ] Create publisher account on VS Code Marketplace
- [ ] Login with VSCE: \`vsce login $PUBLISHER\`
- [ ] Publish extension: \`vsce publish\`

## MCP Server Deployment
- [ ] Create npm account (if publishing to npm)
- [ ] Test server in production-like environment
- [ ] Publish to npm: \`npm publish\`
- [ ] Document installation instructions

## Post-Deployment
- [ ] Verify extension installation from marketplace
- [ ] Test complete user flow
- [ ] Monitor for issues and user feedback
- [ ] Create support channels (GitHub Issues, etc.)

## Files Generated
- \`interactive-vscode-extension/${EXTENSION_NAME}-${EXTENSION_VERSION}.vsix\`
- \`interactive-mcp-server/dist/\` (compiled server)

## Next Steps
1. Update package.json files with your details
2. Follow the DEPLOYMENT_GUIDE.md for detailed instructions
3. Test everything before publishing
4. Set up monitoring and support channels
EOF

print_success "Deployment checklist created: DEPLOYMENT_CHECKLIST.md"

# Summary
echo ""
echo "🎉 Production Preparation Complete!"
echo "=================================="
echo ""
print_success "What's been prepared:"
echo "  📦 VS Code Extension packaged and ready"
echo "  🖥️  MCP Server built and ready"
echo "  📋 Deployment checklist created"
echo "  📚 Documentation updated"
echo ""
print_step "Next steps:"
echo "  1. Update package.json files with your publisher details"
echo "  2. Follow DEPLOYMENT_GUIDE.md for publishing steps"
echo "  3. Test everything before going live"
echo "  4. Set up monitoring and support"
echo ""
print_warning "Important reminders:"
echo "  • Update 'your-publisher-name' in package.json"
echo "  • Add your repository URLs"
echo "  • Create proper icon and banner images"
echo "  • Test the complete user flow"
echo ""
echo "📖 See DEPLOYMENT_GUIDE.md for detailed instructions"
echo "🎯 Ready to make your Interactive MCP system available to the world!" 