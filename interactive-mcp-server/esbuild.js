import esbuild from "esbuild";
import path from "path";

const production = process.argv.includes('--production');

async function main() {
    try {
        await esbuild.build({
            entryPoints: ['src/index.ts'],
            bundle: true,
            format: 'esm', // Use ESM format to match package.json type: "module"
            platform: 'node',
            target: 'node16',
            outfile: 'dist/index.js',
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
                // Only keep ws external (has native bindings)
                'ws'
            ],
            define: {
                // Define any environment variables if needed
            },
            logLevel: 'info'
        });
        
        console.log('✅ Server bundled successfully with esbuild!');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

main();