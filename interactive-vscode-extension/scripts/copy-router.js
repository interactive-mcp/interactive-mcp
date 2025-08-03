const fs = require('fs');
const path = require('path');

// Helper function to recursively copy directories with exclusions
function copyDir(src, dest, excludeDirs = []) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        // Skip excluded directories
        if (entry.isDirectory() && excludeDirs.includes(entry.name)) {
            console.log(`⏭️  Skipping excluded directory: ${entry.name}`);
            continue;
        }
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, excludeDirs);
        } else {
            try {
                fs.copyFileSync(srcPath, destPath);
            } catch (error) {
                if (error.code === 'EACCES') {
                    console.log(`⏭️  Skipping file with permission issues: ${entry.name}`);
                } else {
                    throw error;
                }
            }
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
    console.log('📦 Copying shared router files...');
    
    // Define paths
    const routerDir = path.join(__dirname, '../../shared-router');
    const bundledDir = path.join(__dirname, '../bundled-router');
    
    // Check if router directory exists
    if (!fs.existsSync(routerDir)) {
        console.error('❌ Shared router directory not found:', routerDir);
        process.exit(1);
    }
    
    // Check if router is built
    const routerDistDir = path.join(routerDir, 'dist');
    if (!fs.existsSync(routerDistDir)) {
        console.error('❌ Shared router not built. Run "npm run build" in the router directory first.');
        process.exit(1);
    }
    
    // Clean bundled directory
    if (fs.existsSync(bundledDir)) {
        fs.rmSync(bundledDir, { recursive: true, force: true });
    }
    
    // Copy dist directory
    console.log('📁 Copying dist directory...');
    copyDir(routerDistDir, path.join(bundledDir, 'dist'));
    
    // Copy package.json
    console.log('📄 Copying package.json...');
    copyFile(
        path.join(routerDir, 'package.json'),
        path.join(bundledDir, 'package.json')
    );
    
    // Copy only the external dependencies that aren't bundled
    const routerPackageJson = JSON.parse(fs.readFileSync(path.join(routerDir, 'package.json'), 'utf8'));
    const routerNodeModulesDir = path.join(routerDir, 'node_modules');
    const bundledNodeModulesDir = path.join(bundledDir, 'node_modules');
    
    // Only copy external dependencies (ws package)
    const externalDeps = ['ws'];
    
    if (fs.existsSync(routerNodeModulesDir)) {
        for (const dep of externalDeps) {
            const depSrcPath = path.join(routerNodeModulesDir, dep);
            const depDestPath = path.join(bundledNodeModulesDir, dep);
            
            if (fs.existsSync(depSrcPath)) {
                console.log(`📦 Copying external dependency: ${dep}...`);
                copyDir(depSrcPath, depDestPath, ['.bin', '.cache']);
            } else {
                console.log(`⚠️  External dependency ${dep} not found`);
            }
        }
    }
    
    // Create package.json with only external dependencies
    const bundledPackageJson = {
        name: routerPackageJson.name,
        version: routerPackageJson.version,
        main: routerPackageJson.main,
        type: routerPackageJson.type,
        dependencies: {
            ws: routerPackageJson.dependencies.ws
        }
    };
    
    fs.writeFileSync(
        path.join(bundledDir, 'package.json'),
        JSON.stringify(bundledPackageJson, null, 2)
    );
    
    console.log('✅ Router bundled successfully (external dependencies copied)!');
    
    console.log('✅ Shared router bundled successfully!');
    console.log('📍 Bundled to:', bundledDir);
    
} catch (error) {
    console.error('❌ Error bundling router:', error.message);
    process.exit(1);
}