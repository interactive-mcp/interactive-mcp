@echo off
setlocal enabledelayedexpansion

REM 🚀 Interactive MCP Production Preparation Script (Windows)
REM This script helps prepare your Interactive MCP system for production deployment

echo 🚀 Interactive MCP Production Preparation
echo ========================================

REM Check prerequisites
echo 📋 Checking prerequisites...

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed

REM Check if we're in the right directory
if not exist "interactive-vscode-extension" (
    echo ❌ interactive-vscode-extension folder not found
    echo Please run this script from the root directory containing both folders
    pause
    exit /b 1
)

if not exist "interactive-mcp-server" (
    echo ❌ interactive-mcp-server folder not found
    echo Please run this script from the root directory containing both folders
    pause
    exit /b 1
)

echo ✅ Project structure verified

REM Install VSCE if not already installed
echo 📋 Installing VS Code Extension Manager (VSCE)...
where vsce >nul 2>nul
if %errorlevel% neq 0 (
    echo Installing VSCE...
    npm install -g @vscode/vsce
    echo ✅ VSCE installed
) else (
    echo ✅ VSCE already installed
)

REM Prepare VS Code Extension
echo 📋 Preparing VS Code Extension...

cd interactive-vscode-extension

REM Install dependencies
echo 📋 Installing extension dependencies...
npm install

REM Compile TypeScript
echo 📋 Compiling TypeScript...
npm run compile

REM Run linting
echo 📋 Running ESLint...
npm run lint

REM Package extension
echo 📋 Packaging extension...
npm run package

echo ✅ VS Code extension prepared successfully!

REM Get extension details (simplified for batch)
echo.
echo ✅ Extension Details:
echo   📦 Check package.json for name and version
echo   📄 .vsix file created in current directory

cd ..

REM Prepare MCP Server
echo 📋 Preparing MCP Server...

cd interactive-mcp-server

REM Install dependencies
echo 📋 Installing server dependencies...
npm install

REM Build TypeScript
echo 📋 Building server...
npm run build

echo ✅ MCP server prepared successfully!

echo.
echo ✅ Server Details:
echo   📦 Check package.json for name and version
echo   📁 Built files in dist/ directory

cd ..

REM Create deployment checklist
echo 📋 Creating deployment checklist...

echo # 🚀 Deployment Checklist > DEPLOYMENT_CHECKLIST.md
echo. >> DEPLOYMENT_CHECKLIST.md
echo ## Pre-Deployment >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Update package.json with your publisher details >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Add proper repository URLs >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Create icon and banner images >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Test extension thoroughly >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Write comprehensive documentation >> DEPLOYMENT_CHECKLIST.md
echo. >> DEPLOYMENT_CHECKLIST.md
echo ## VS Code Extension Deployment >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Create Microsoft/Azure DevOps account >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Generate Personal Access Token >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Create publisher account on VS Code Marketplace >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Login with VSCE: `vsce login your-publisher-name` >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Publish extension: `vsce publish` >> DEPLOYMENT_CHECKLIST.md
echo. >> DEPLOYMENT_CHECKLIST.md
echo ## MCP Server Deployment >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Create npm account (if publishing to npm) >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Test server with npx (no global install needed) >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Publish to npm: `npm publish` >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Test npx installation: `npx interactive-mcp-server` >> DEPLOYMENT_CHECKLIST.md
echo. >> DEPLOYMENT_CHECKLIST.md
echo ## Post-Deployment >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Verify extension installation from marketplace >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Test complete user flow >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Monitor for issues and user feedback >> DEPLOYMENT_CHECKLIST.md
echo - [ ] Create support channels (GitHub Issues, etc.) >> DEPLOYMENT_CHECKLIST.md

echo ✅ Deployment checklist created: DEPLOYMENT_CHECKLIST.md

REM Summary
echo.
echo 🎉 Production Preparation Complete!
echo ==================================
echo.
echo ✅ What's been prepared:
echo   📦 VS Code Extension packaged and ready
echo   🖥️  MCP Server built and ready
echo   📋 Deployment checklist created
echo   📚 Documentation updated
echo.
echo 📋 Next steps:
echo   1. Update package.json files with your publisher details
echo   2. Follow DEPLOYMENT_GUIDE.md for publishing steps
echo   3. Test everything before going live
echo   4. Set up monitoring and support
echo.
echo ⚠️  Important reminders:
echo   • Update 'your-publisher-name' in package.json
echo   • Add your repository URLs
echo   • Create proper icon and banner images
echo   • Test the complete user flow
echo.
echo 📖 See DEPLOYMENT_GUIDE.md for detailed instructions
echo 🎯 Ready to make your Interactive MCP system available to the world!
echo.
pause 