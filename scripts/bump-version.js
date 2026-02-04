const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

// Use UTC timestamp to avoid cache collisions (YYYYMMDDHHmm)
const newVersion = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 12);

const cssRegex = /(inflation-site-optimized\.min\.css\?v=)([0-9A-Za-z._-]+)/;
const jsRegex = /(inflation-site-optimized\.min\.js\?v=)([0-9A-Za-z._-]+)/;

if (!cssRegex.test(html) || !jsRegex.test(html)) {
    console.error('❌ Version bump failed: CSS/JS version strings not found in index.html');
    process.exit(1);
}

const oldCssVersion = html.match(cssRegex)[2];
const oldJsVersion = html.match(jsRegex)[2];

const updated = html
    .replace(cssRegex, `$1${newVersion}`)
    .replace(jsRegex, `$1${newVersion}`);

fs.writeFileSync(indexPath, updated, 'utf8');

console.log('✅ Version bump complete');
console.log(`CSS: ${oldCssVersion} -> ${newVersion}`);
console.log(`JS:  ${oldJsVersion} -> ${newVersion}`);
