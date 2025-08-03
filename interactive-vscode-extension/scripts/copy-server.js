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
    
    // Copy only the external dependencies that aren't bundled
    const serverPackageJson = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
    const serverNodeModulesDir = path.join(serverDir, 'node_modules');
    const bundledNodeModulesDir = path.join(bundledDir, 'node_modules');
    
    // Only copy external dependencies (everything else is bundled by esbuild)
    const externalDeps = ['ws']; // Only ws has native bindings that can't be bundled
    const scopedDeps = []; // No scoped dependencies needed - all bundled
    
    if (fs.existsSync(serverNodeModulesDir)) {
        // Copy regular dependencies
        for (const dep of externalDeps) {
            const depSrcPath = path.join(serverNodeModulesDir, dep);
            const depDestPath = path.join(bundledNodeModulesDir, dep);
            
            if (fs.existsSync(depSrcPath)) {
                console.log(`📦 Copying external dependency: ${dep}...`);
                copyDir(depSrcPath, depDestPath, ['.bin', '.cache']);
            } else {
                console.log(`⚠️  External dependency ${dep} not found`);
            }
        }
        
        // Copy scoped dependencies (entire scope directory)
        for (const scope of scopedDeps) {
            const scopeSrcPath = path.join(serverNodeModulesDir, scope);
            const scopeDestPath = path.join(bundledNodeModulesDir, scope);
            
            if (fs.existsSync(scopeSrcPath)) {
                console.log(`📦 Copying scoped dependency: ${scope}...`);
                copyDir(scopeSrcPath, scopeDestPath, ['.bin', '.cache']);
            } else {
                console.log(`⚠️  Scoped dependency ${scope} not found`);
            }
        }
    }
    
    // Create package.json with only external dependencies
    const bundledPackageJson = {
        name: serverPackageJson.name,
        version: serverPackageJson.version,
        main: serverPackageJson.main,
        type: serverPackageJson.type,
        dependencies: {
            'ws': serverPackageJson.dependencies.ws
        },
        scripts: {
            start: "node dist/index.js"
        }
    };
    
    fs.writeFileSync(
        path.join(bundledDir, 'package.json'),
        JSON.stringify(bundledPackageJson, null, 2)
    );
    
    console.log('✅ Server bundled successfully (external dependencies copied)!');
    
    console.log('✅ MCP server bundled successfully!');
    console.log('📍 Bundled to:', bundledDir);
    
} catch (error) {
    console.error('❌ Error bundling server:', error.message);
    process.exit(1);
} 