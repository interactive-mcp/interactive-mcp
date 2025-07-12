const fs = require('fs');
const path = require('path');

// Helper function to recursively copy directories
function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Helper function to copy a single file
function copyFile(src, dest) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
}

try {
    console.log('📦 Copying MCP server files...');
    
    // Define paths
    const serverDir = path.join(__dirname, '../../interactive-mcp-server');
    const bundledDir = path.join(__dirname, '../bundled-server');
    
    // Check if server directory exists
    if (!fs.existsSync(serverDir)) {
        console.error('❌ MCP server directory not found:', serverDir);
        process.exit(1);
    }
    
    // Check if server is built
    const serverDistDir = path.join(serverDir, 'dist');
    if (!fs.existsSync(serverDistDir)) {
        console.error('❌ MCP server not built. Run "npm run build" in the server directory first.');
        process.exit(1);
    }
    
    // Clean bundled directory
    if (fs.existsSync(bundledDir)) {
        fs.rmSync(bundledDir, { recursive: true, force: true });
    }
    
    // Copy dist directory
    console.log('📁 Copying dist directory...');
    copyDir(serverDistDir, path.join(bundledDir, 'dist'));
    
    // Copy package.json
    console.log('📄 Copying package.json...');
    copyFile(
        path.join(serverDir, 'package.json'),
        path.join(bundledDir, 'package.json')
    );
    
    // Copy node_modules (only production dependencies)
    const serverPackageJson = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
    if (serverPackageJson.dependencies) {
        console.log('📦 Copying production dependencies...');
        const serverNodeModulesDir = path.join(serverDir, 'node_modules');
        const bundledNodeModulesDir = path.join(bundledDir, 'node_modules');
        
        // Copy the entire node_modules directory
        if (fs.existsSync(serverNodeModulesDir)) {
            copyDir(serverNodeModulesDir, bundledNodeModulesDir);
            console.log('✅ Dependencies copied successfully');
        } else {
            console.log('⚠️  No node_modules found in server directory');
        }
        
        // Create a minimal package.json for the bundled server
        const bundledPackageJson = {
            name: serverPackageJson.name,
            version: serverPackageJson.version,
            main: serverPackageJson.main,
            type: serverPackageJson.type,
            dependencies: serverPackageJson.dependencies
        };
        
        fs.writeFileSync(
            path.join(bundledDir, 'package.json'),
            JSON.stringify(bundledPackageJson, null, 2)
        );
    }
    
    console.log('✅ MCP server bundled successfully!');
    console.log('📍 Bundled to:', bundledDir);
    
} catch (error) {
    console.error('❌ Error bundling server:', error.message);
    process.exit(1);
} 