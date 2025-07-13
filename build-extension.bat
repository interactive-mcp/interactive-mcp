@echo off
REM Interactive MCP Extension - Complete Build Script (Windows)
REM This script builds everything needed for the VS Code extension

setlocal enabledelayedexpansion

echo 🚀 Starting Interactive MCP Extension Build Process...
echo ==================================================

REM Check if we're in the right directory
if not exist "interactive-mcp-server" (
    echo ❌ Error: interactive-mcp-server directory not found
    echo Please run this script from the root directory
    goto :error
)

if not exist "interactive-vscode-extension" (
    echo ❌ Error: interactive-vscode-extension directory not found
    echo Please run this script from the root directory
    goto :error
)

REM Step 1: Build MCP Server
echo 🔄 Building MCP Server...
cd interactive-mcp-server

if not exist "package.json" (
    echo ❌ Error: package.json not found in interactive-mcp-server directory
    goto :error
)

echo 🔄 Installing MCP server dependencies...
call npm install
if !errorlevel! neq 0 goto :error

echo 🔄 Building MCP server TypeScript...
call npm run build
if !errorlevel! neq 0 goto :error

echo ✅ MCP Server built successfully
cd ..

REM Step 2: Build VS Code Extension
echo 🔄 Building VS Code Extension...
cd interactive-vscode-extension

if not exist "package.json" (
    echo ❌ Error: package.json not found in interactive-vscode-extension directory
    goto :error
)

echo 🔄 Installing VS Code extension dependencies...
call npm install
if !errorlevel! neq 0 goto :error

echo 🔄 Bundling MCP server and shared router into extension...
call npm run bundle-all
if !errorlevel! neq 0 goto :error

echo 🔄 Compiling VS Code extension TypeScript...
call npm run compile
if !errorlevel! neq 0 goto :error

echo 🔄 Packaging extension into VSIX file...
call npm run package
if !errorlevel! neq 0 goto :error

REM Find the VSIX file
for %%f in (*.vsix) do set "VSIX_FILE=%%f"

if defined VSIX_FILE (
    echo ✅ Extension packaged successfully!
    echo.
    echo 📦 VSIX File Location: %cd%\!VSIX_FILE!
    echo.
    echo 🎯 To install manually:
    echo    1. Open VS Code
    echo    2. Go to Extensions (Ctrl+Shift+X^)
    echo    3. Click the '...' menu
    echo    4. Select 'Install from VSIX...'
    echo    5. Choose: %cd%\!VSIX_FILE!
    echo.
    echo 🔄 To reinstall (if already installed^):
    echo    1. Uninstall the current version first
    echo    2. Then follow the installation steps above
) else (
    echo ❌ Error: VSIX file not found! Package command may have failed.
    goto :error
)

cd ..

echo ✅ Build process completed successfully!
echo.
echo 📋 Summary:
echo    ✅ MCP Server built
echo    ✅ Shared Router built
echo    ✅ VS Code Extension compiled
echo    ✅ Server and Router bundled into extension
echo    ✅ VSIX package created
echo.
echo ⚠️  Note: Manual installation required - automatic installation was skipped

goto :end

:error
echo.
echo ❌ Build process failed!
cd ..
exit /b 1

:end
pause