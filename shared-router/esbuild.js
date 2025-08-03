import esbuild from "esbuild";

const production = process.argv.includes('--production');

async function main() {
    try {
        await esbuild.build({
            entryPoints: ['src/router.ts'],
            bundle: true,
            format: 'esm', // Use ESM format to match package.json type: "module"
            platform: 'node',
            target: 'node16',
            outfile: 'dist/router.js',
            minify: production,
            sourcemap: !production,
            external: [
                // Keep Node.js built-ins as external
                'crypto',
                'path',
                'http',
                'url',
                'os',
                'fs',
                'events',
                'stream',
                'buffer',
                'util',
                'net',
                'tls',
                'https',
                // Keep npm packages that use dynamic requires as external
                'ws'
            ],
            logLevel: 'info'
        });
        
        console.log('✅ Router bundled successfully with esbuild!');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

main();