/**
 * Script to update ALL data in index.html from Google Sheets
 * - Yearly inflation table (static HTML)
 * - Data cards (static HTML)
 * - Graph data (inline JavaScript - no API calls)
 */

const https = require('https');
const fs = require('fs');
const { fetchTilastokeskusData } = require('./fetch-tilastokeskus');

const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
const API_KEY = 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g';

// Fetch data from a specific range
function fetchRange(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

    return new Promise((resolve, reject) => {
        console.log(`Fetching: ${range}...`);
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`API error: ${json.error.message}`));
                        return;
                    }
                    if (!json.values) {
                        reject(new Error('No values in response'));
                        return;
                    }
                    console.log(`✓ Fetched ${json.values.length} rows from ${range}`);
                    resolve(json.values);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

// Process raw inflation data for graphs (HICP)
function processInflationData(rawData) {
    const processed = [];

    rawData.forEach((row, index) => {
        if (index === 0 || !row[0] || !row[1]) return; // Skip header

        const date = row[0]; // YYYY-MM format

        // Process inflation %
        const valueStr = row[1].toString();
        const cleanValue = valueStr.replace('%', '').replace(/\s/g, '').replace(',', '.');
        const inflation = parseFloat(cleanValue);

        if (isNaN(inflation)) return;

        // Process HICP index (column C)
        let hicp = 0;
        if (row[2]) {
            const hicpStr = row[2].toString();
            const cleanHicp = hicpStr.replace(/\s/g, '').replace(',', '.');
            hicp = parseFloat(cleanHicp);
            if (isNaN(hicp)) hicp = 0;
        }

        processed.push({
            date: date,
            inflation: inflation,
            hicp: hicp
        });
    });

    console.log(`Processed ${processed.length} HICP data points`);
    return processed;
}

// Process CPI data from Tilastokeskus
function processCPIData(rawData) {
    const processed = [];

    rawData.forEach((row, index) => {
        if (index === 0 || !row[0] || !row[1]) return; // Skip header

        const date = row[0]; // YYYY-MM format

        // Process inflation %
        const valueStr = row[1].toString();
        const cleanValue = valueStr.replace('%', '').replace(/\s/g, '').replace(',', '.');
        const inflation = parseFloat(cleanValue);

        if (isNaN(inflation)) return;

        // Process CPI index (column C)
        let cpi = 0;
        if (row[2]) {
            const cpiStr = row[2].toString();
            const cleanCpi = cpiStr.replace(/\s/g, '').replace(',', '.');
            cpi = parseFloat(cleanCpi);
            if (isNaN(cpi)) cpi = 0;
        }

        processed.push({
            date: date,
            inflation: inflation,
            cpi: cpi
        });
    });

    // Back-calculate missing CPI index values using inflation rates
    // Formula: index[M] = index[M+12] / (1 + inflation[M+12] / 100)
    const dateMap = {};
    processed.forEach((d, i) => { dateMap[d.date] = i; });

    let backCalcCount = 0;
    for (let i = processed.length - 1; i >= 0; i--) {
        if (processed[i].cpi > 0) continue; // already has index

        const parts = processed[i].date.split('-');
        const futureDate = (parseInt(parts[0]) + 1) + '-' + parts[1];
        const fi = dateMap[futureDate];

        if (fi !== undefined && processed[fi].cpi > 0 && !isNaN(processed[fi].inflation)) {
            processed[i].cpi = processed[fi].cpi / (1 + processed[fi].inflation / 100);
            backCalcCount++;
        }
    }

    console.log(`Processed ${processed.length} CPI data points (${backCalcCount} index values back-calculated)`);
    return processed;
}

// Calculate yearly averages
function calculateYearlyAverages(rawData) {
    const yearlyData = {};

    rawData.forEach((row, index) => {
        if (index === 0 || !row[0] || !row[1]) return;

        const dateStr = row[0];
        const valueStr = row[1].toString();
        const cleanValue = valueStr.replace('%', '').replace(/\s/g, '').replace(',', '.');
        const value = parseFloat(cleanValue);

        if (isNaN(value)) return;

        let year;
        if (dateStr.includes('-')) {
            year = parseInt(dateStr.split('-')[0]);
        } else if (dateStr.includes('/')) {
            year = parseInt(dateStr.split('/')[1]);
        } else {
            return;
        }

        if (year < 2000 || year > 2030) return;

        if (!yearlyData[year]) {
            yearlyData[year] = { sum: 0, count: 0 };
        }

        yearlyData[year].sum += value;
        yearlyData[year].count++;
    });

    const averages = {};
    for (const year in yearlyData) {
        const avg = yearlyData[year].sum / yearlyData[year].count;
        averages[year] = parseFloat(avg.toFixed(1));
    }

    console.log(`Calculated averages for ${Object.keys(averages).length} years`);
    return averages;
}

// Process key metrics
function processKeyMetrics(rawData) {
    const metrics = {};

    rawData.forEach((row, index) => {
        if (index === 0 || !row[0] || !row[1]) return; // Skip header

        const key = row[0].toString().trim();
        const value = row[1].toString().trim();
        metrics[key] = value;
    });

    console.log(`Processed ${Object.keys(metrics).length} key metrics`);
    return metrics;
}

// Generate yearly table HTML
function generateYearlyTableHTML(yearlyAverages) {
    const currentYear = new Date().getFullYear();
    const years = Object.keys(yearlyAverages).map(Number).sort((a, b) => b - a);

    if (years.length < 6) {
        throw new Error(`Not enough years: ${years.length}`);
    }

    const visibleYears = years.slice(0, 6);
    const olderYears = years.slice(6);

    const generateItem = (year, value, isCurrent = false) => {
        const arrow = value >= 0 ? '↑' : '↓';
        const arrowClass = value >= 0 ? 'up' : 'down';
        const valueClass = value >= 0 ? 'positive' : 'negative';

        if (isCurrent) {
            return `                    <div class="year-item current-year-item">
                        <span class="current-year-badge">Kuluva vuosi</span>
                        <span class="year">${year}</span>
                        <span class="value ${valueClass}">${value}% <span class="trend-arrow ${arrowClass}">${arrow}</span></span>
                    </div>`;
        }
        return `                    <div class="year-item"><span class="year">${year}</span><span class="value ${valueClass}">${value}% <span class="trend-arrow ${arrowClass}">${arrow}</span></span></div>`;
    };

    let html = '\n';

    // Visible columns
    html += '                <div class="year-column">\n';
    html += generateItem(visibleYears[0], yearlyAverages[visibleYears[0]], visibleYears[0] === currentYear) + '\n';
    html += generateItem(visibleYears[3], yearlyAverages[visibleYears[3]]) + '\n';
    html += '                </div>\n';

    html += '                <div class="year-column">\n';
    html += generateItem(visibleYears[1], yearlyAverages[visibleYears[1]]) + '\n';
    html += generateItem(visibleYears[4], yearlyAverages[visibleYears[4]]) + '\n';
    html += '                </div>\n';

    html += '                <div class="year-column">\n';
    html += generateItem(visibleYears[2], yearlyAverages[visibleYears[2]]) + '\n';
    html += generateItem(visibleYears[5], yearlyAverages[visibleYears[5]]) + '\n';
    html += '                </div>\n';

    // Older years (hidden)
    for (let i = 0; i < olderYears.length; i += 2) {
        html += '                <div class="year-column older-years" style="display: none;">\n';
        html += generateItem(olderYears[i], yearlyAverages[olderYears[i]]) + '\n';
        if (olderYears[i + 1]) {
            html += generateItem(olderYears[i + 1], yearlyAverages[olderYears[i + 1]]) + '\n';
        }
        html += '                </div>\n';
    }

    html += '            ';
    return html;
}

// Generate data cards HTML
function generateDataCardsHTML(metrics) {
    // Map the metrics to the card structure
    const currentYear = new Date().getFullYear();
    const cards = [
        { title: "Viimeisin inflaatiolukema", key: "Viimeisin inflaatio", description: "Viimeisin Eurostatin julkaisema vuosi-inflaatio. Perustuu kuluttajahintaindeksiin." },
        { title: "Muutos edelliseen kuukauteen", key: "Muutos edelliseen kuukauteen", description: "Kertoo, onko hintojen nousuvauhti kiihtynyt vai hidastunut edellisestä kuukaudesta." },
        { title: "12 kuukauden keskiarvo", key: "12 kk keskiarvo", description: "Keskimääräinen inflaatio viimeisten 12 kuukauden aikana. Vakaampi kuva hintakehityksestä." },
        { title: `Vuoden ${currentYear} keskiarvo`, key: "Vuoden alun keskiarvo", description: "Inflaation keskiarvo vuoden alusta tähän hetkeen. Hyödyllinen budjetointiin ja analyysiin." },
        { title: "Vuosi sitten (sama kuukausi)", key: "Sama kuukausi vuotta aiemmin", description: "Vertailu viime vuoden samaan kuukauteen näyttää, miten paljon inflaatio on muuttunut vuodessa." }
    ];

    let html = '';

    cards.forEach(card => {
        let value = metrics[card.key] || '0.0 %';

        // Parse numeric value
        const numValue = parseFloat(value.replace('%', '').replace(',', '.').trim());

        // Handle NaN case (missing data)
        if (isNaN(numValue)) {
            console.warn(`Warning: NaN value for "${card.key}", using fallback "Ei dataa"`);
            value = 'Ei dataa';
            html += `                <div class="tile">
                    <h3>${card.title}</h3>
                    <p class="highlight neutral">${value}</p>
                    <p>${card.description}</p>
                </div>\n`;
            return;
        }

        let cssClass = 'neutral';
        let symbol = '';
        if (numValue > 0) {
            cssClass = 'positive';
            symbol = '▲ ';
        } else if (numValue < 0) {
            cssClass = 'negative';
            symbol = '▼ ';
        }

        html += `                <div class="tile">
                    <h3>${card.title}</h3>
                    <p class="highlight ${cssClass}">${symbol}${value}</p>
                    <p>${card.description}</p>
                </div>\n`;
    });

    return html;
}

// Generate inline JavaScript data (HICP + CPI)
function generateInlineDataScript(inflationData, cpiData) {
    // Convert HICP to array format: ["date", inflation, hicp]
    const hicpArray = inflationData.map(d => `["${d.date}", ${d.inflation}, ${d.hicp}]`).join(',\n    ');

    // Convert CPI to array format: ["date", inflation, cpi]
    const cpiArray = cpiData.map(d => `["${d.date}", ${d.inflation}, ${d.cpi}]`).join(',\n    ');

    return `
    // === STATIC DATA (Auto-generated by update-all-data.js) ===
    // Last updated: ${new Date().toISOString()}
    // This data is embedded directly in the page to avoid API calls

    // Eurostat HICP data - Format: [date, inflation%, HICP index]
    const STATIC_INFLATION_DATA = [
    ${hicpArray}
];

    // Tilastokeskus CPI data - Format: [date, inflation%, CPI index]
    const STATIC_CPI_DATA = [
    ${cpiArray}
];

    // Set flags to indicate static data is available
    window.USE_STATIC_DATA = true;
    window.STATIC_DATA_AVAILABLE = true;

    console.log('✅ HICP data loaded:', STATIC_INFLATION_DATA.length, 'data points');
    console.log('✅ CPI data loaded:', STATIC_CPI_DATA.length, 'data points');
    `;
}

// Validate data quality before updating
function validateData(newInflationData, newCPIData, currentHTML) {
    console.log('\n=== Validating data quality ===\n');

    // Extract current HICP data count from HTML (if exists)
    const currentHICPMatch = currentHTML.match(/STATIC_INFLATION_DATA = \[([\s\S]*?)\];/);
    let currentHICPCount = 0;
    if (currentHICPMatch) {
        // Count lines that start with ["
        currentHICPCount = (currentHICPMatch[1].match(/\["/g) || []).length;
    }

    // Extract current CPI data count from HTML (if exists)
    const currentCPIMatch = currentHTML.match(/STATIC_CPI_DATA = \[([\s\S]*?)\];/);
    let currentCPICount = 0;
    if (currentCPIMatch) {
        currentCPICount = (currentCPIMatch[1].match(/\["/g) || []).length;
    }

    const newHICPCount = newInflationData.length;
    const newCPICount = newCPIData.length;

    console.log(`Current HICP data points: ${currentHICPCount}`);
    console.log(`New HICP data points: ${newHICPCount}`);
    console.log(`Current CPI data points: ${currentCPICount}`);
    console.log(`New CPI data points: ${newCPICount}`);

    // Validation rules for HICP:
    // 1. New data must not have FEWER rows than current (allows historical corrections)
    if (currentHICPCount > 0 && newHICPCount < currentHICPCount) {
        throw new Error(`HICP validation failed: New data has ${newHICPCount} rows, but current has ${currentHICPCount}. This suggests incomplete data from Google Sheets.`);
    }

    // 2. Sanity check: Must have at least 300 data points (we have ~347 historical data)
    if (newHICPCount < 300) {
        throw new Error(`HICP validation failed: Only ${newHICPCount} rows found. Expected at least 300. Data seems incomplete.`);
    }

    // Validation rules for CPI:
    // CPI data from Tilastokeskus has more historical data (starts from 1980)
    // We should expect at least 400 data points
    if (newCPICount > 0 && newCPICount < 400) {
        throw new Error(`CPI validation failed: Only ${newCPICount} rows found. Expected at least 400. Data seems incomplete.`);
    }

    // 3. Check that recent months have data (last 3 months should exist)
    const now = new Date();
    const recentMonths = [];
    for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        recentMonths.push(monthStr);
    }

    const hicpMonths = newInflationData.map(d => d.date);
    const missingRecentHICP = recentMonths.filter(m => !hicpMonths.includes(m));

    if (missingRecentHICP.length > 1) {
        // Allow 1 missing month (current month might not be published yet)
        console.warn(`Warning: Missing ${missingRecentHICP.length} recent HICP months: ${missingRecentHICP.join(', ')}`);
        console.warn('This is acceptable if data hasn\'t been published yet.');
    }

    console.log('✓ Data validation passed');
    console.log(`✓ HICP data count OK: ${newHICPCount} rows (current: ${currentHICPCount})`);
    console.log(`✓ CPI data count OK: ${newCPICount} rows (current: ${currentCPICount})`);

    return true;
}

// Main update function
async function updateAllData() {
    console.log('=== Starting data update ===\n');

    // Fetch HICP and metrics from Google Sheets, CPI directly from Tilastokeskus
    const [rawInflationData, metricsData, tilastokeskusData] = await Promise.all([
        fetchRange('Raakadata!A:C'),      // Eurostat HICP data
        fetchRange('Key Metrics!A:B'),
        fetchTilastokeskusData()          // CPI directly from Tilastokeskus (bypasses Google Sheets)
    ]);

    // Process data
    const inflationData = processInflationData(rawInflationData);
    // Map Tilastokeskus format {date, inflation, index} → {date, inflation, cpi}
    const cpiData = tilastokeskusData.map(d => ({ date: d.date, inflation: d.inflation, cpi: d.index || 0 }));
    const yearlyAverages = calculateYearlyAverages(rawInflationData);
    const keyMetrics = processKeyMetrics(metricsData);

    // Read current HTML to validate against
    const htmlPath = './index.html';
    let currentHTML = '';
    try {
        currentHTML = fs.readFileSync(htmlPath, 'utf8');
        console.log(`Loaded existing index.html (${currentHTML.length} bytes)`);
    } catch (e) {
        console.log('No existing index.html found, creating new one');
    }

    // Validate data quality
    validateData(inflationData, cpiData, currentHTML);

    console.log('\n=== Generating HTML ===\n');

    // Generate HTML sections
    const yearlyTableHTML = generateYearlyTableHTML(yearlyAverages);
    const dataCardsHTML = generateDataCardsHTML(keyMetrics);
    const inlineDataScript = generateInlineDataScript(inflationData, cpiData);

    // Use the already loaded HTML for modifications
    let html = currentHTML;
    console.log(`HTML size for modifications: ${html.length} bytes`);

    // Update yearly table
    console.log('Updating yearly table...');
    const tableRegex = /(<div class="compact-table-grid"[^>]*>)[\s\S]*?(<\/div>\s*<div class="show-more-container">)/;
    if (!tableRegex.test(html)) {
        throw new Error('Could not find yearly table section');
    }
    html = html.replace(tableRegex, `$1${yearlyTableHTML}$2`);

    // Update data cards
    console.log('Updating data cards...');
    // Anchor to the carousel section explicitly to avoid accidentally matching
    // closing tags in sections that follow (e.g. the charts section).
    const carouselSectionStart = html.indexOf('<section class="carousel"');
    const carouselSectionEnd = html.indexOf('</section>', carouselSectionStart);
    const cardsStart = html.indexOf('<div class="carousel-inner">', carouselSectionStart);
    // lastIndexOf finds the carousel-inner's closing </div> — the last </div> before </section>
    // This is robust regardless of buttons or other elements between </div> and </section>
    const cardsEnd = html.lastIndexOf('</div>', carouselSectionEnd);

    if (carouselSectionStart === -1 || carouselSectionEnd === -1 || cardsStart === -1 || cardsEnd === -1) {
        throw new Error('Could not find data cards section');
    }
    html = html.substring(0, cardsStart + '<div class="carousel-inner">'.length) + '\n' +
           dataCardsHTML +
           '            ' + html.substring(cardsEnd);

    // Update inline data script - MUST BE BEFORE inflation-site-optimized.min.js
    console.log('Updating inline data script...');
    const scriptMarker = '// === STATIC DATA (Auto-generated';
    const scriptStart = html.indexOf(scriptMarker);

    if (scriptStart === -1) {
        // Add script BEFORE inflation-site-optimized.min.js
        const mainScriptLine = html.indexOf('inflation-site-optimized.min.js');
        if (mainScriptLine === -1) {
            throw new Error('Could not find inflation-site-optimized.min.js script tag');
        }
        // Find start of the <script> tag for inflation-site-optimized.min.js
        const mainScriptStart = html.lastIndexOf('<script', mainScriptLine);

        html = html.substring(0, mainScriptStart) +
               '    <!-- Static data - loaded before main script -->\n    <script>' + inlineDataScript + '\n    </script>\n\n    ' +
               html.substring(mainScriptStart);
        console.log('✓ Added new inline data script BEFORE main script');
    } else {
        // Replace existing script
        const scriptEnd = html.indexOf('</script>', scriptStart);
        if (scriptEnd === -1) {
            throw new Error('Could not find end of inline data script');
        }
        const scriptTagStart = html.lastIndexOf('<script>', scriptStart);
        html = html.substring(0, scriptTagStart) +
               '<script>' + inlineDataScript + '\n    ' +
               html.substring(scriptEnd);
        console.log('✓ Updated existing inline data script');
    }

    // Write updated HTML
    fs.writeFileSync('./index.html', html, 'utf8');

    console.log('\n=== Update complete ===');
    console.log(`✓ Yearly table: ${Object.keys(yearlyAverages).length} years`);
    console.log(`✓ Data cards: ${Object.keys(keyMetrics).length} metrics`);
    console.log(`✓ HICP graph data: ${inflationData.length} data points`);
    console.log(`✓ CPI graph data: ${cpiData.length} data points`);
    console.log('\nYou can now test locally and commit the changes.');
}

// Run
updateAllData()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    });
