const fs = require('fs');
const { minify } = require('terser');

async function minifyJS() {
    console.log('📦 Minifying JavaScript...');

    try {
        const code = fs.readFileSync('inflation-site-optimized.js', 'utf8');

        const result = await minify(code, {
            compress: {
                dead_code: true,
                drop_console: false, // Keep console logs for debugging
                drop_debugger: true,
                keep_classnames: true,
                keep_fnames: true
            },
            mangle: {
                keep_classnames: true,
                keep_fnames: true
            },
            format: {
                comments: false
            }
        });

        if (result.code) {
            fs.writeFileSync('inflation-site-optimized.min.js', result.code);
            console.log('✅ JavaScript minified successfully!');

            const originalSize = (fs.statSync('inflation-site-optimized.js').size / 1024).toFixed(2);
            const minifiedSize = (fs.statSync('inflation-site-optimized.min.js').size / 1024).toFixed(2);
            const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

            console.log(`📊 Original: ${originalSize} KB`);
            console.log(`📊 Minified: ${minifiedSize} KB`);
            console.log(`💾 Saved: ${savings}%`);
        }
    } catch (error) {
        console.error('❌ Minification failed:', error);
        process.exit(1);
    }
}

minifyJS();
