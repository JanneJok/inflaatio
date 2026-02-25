/**
 * Fetch Tilastokeskus CPI data from PxWeb API
 *
 * Returns inflation data in the same format as Eurostat HICP data
 */

const https = require('https');

// PxWeb API endpoints
const INFLATION_URL = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_122p.px';
const INDEX_URL = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_11xs.px';

/**
 * Make a POST request to PxWeb API
 */
function fetchPxWebData(url, query) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const postData = JSON.stringify(query);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * Fetch inflation data (vuosimuutos %)
 */
async function fetchInflationData() {
    console.log('Fetching CPI inflation data from Tilastokeskus...');

    // Query all months
    const query = {
        "query": [
            {
                "code": "Kuukausi",
                "selection": {
                    "filter": "all",
                    "values": ["*"]
                }
            }
        ],
        "response": {
            "format": "json-stat2"
        }
    };

    const data = await fetchPxWebData(INFLATION_URL, query);
    console.log(`✓ Fetched inflation data: ${Object.keys(data.dimension.Kuukausi.category.label).length} months`);
    return data;
}

/**
 * Fetch index data (kokonaisindeksi)
 */
async function fetchIndexData() {
    console.log('Fetching CPI index data from Tilastokeskus...');

    // Query: All months, Tiedot = "ip_0_2015" (2015=100 baseline index)
    const query = {
        "query": [
            {
                "code": "Kuukausi",
                "selection": {
                    "filter": "all",
                    "values": ["*"]
                }
            },
            {
                "code": "Tiedot",
                "selection": {
                    "filter": "item",
                    "values": ["ip_0_2015"]
                }
            }
        ],
        "response": {
            "format": "json-stat2"
        }
    };

    const data = await fetchPxWebData(INDEX_URL, query);
    console.log(`✓ Fetched index data: ${Object.keys(data.dimension.Kuukausi.category.label).length} months`);
    return data;
}

/**
 * Process and combine inflation + index data
 * Returns array of: [{date: "YYYY-MM", inflation: 1.5, index: 123.4}, ...]
 */
function processCPIData(inflationData, indexData) {
    const monthLabels = inflationData.dimension.Kuukausi.category.label;
    const inflationValues = inflationData.value;

    const indexLabels = indexData.dimension.Kuukausi.category.label;
    const indexValues = indexData.value;

    // Build lookup map: monthCode → index value
    // Cannot use positional index i — the two APIs may have different month ranges
    const indexByCode = {};
    Object.keys(indexLabels).forEach((code, i) => {
        indexByCode[code] = indexValues[i];
    });

    const processed = [];

    Object.keys(monthLabels).forEach((monthCode, i) => {
        const [year, month] = monthCode.split('M');
        const dateStr = `${year}-${month}`;

        const inflation = inflationValues[i];
        const indexVal = indexByCode[monthCode];

        if (inflation !== null && inflation !== undefined) {
            processed.push({
                date: dateStr,
                inflation: parseFloat(inflation),
                index: (indexVal !== null && indexVal !== undefined) ? parseFloat(indexVal) : null
            });
        }
    });

    // Back-calculate missing index values: index[M] = index[M+12] / (1 + inflation[M+12] / 100)
    // Works backwards so one known anchor propagates to all earlier months
    const codeToI = {};
    processed.forEach((d, i) => { codeToI[d.date] = i; });

    let backCalcCount = 0;
    for (let i = processed.length - 1; i >= 0; i--) {
        if (processed[i].index !== null) continue;
        const [y, m] = processed[i].date.split('-');
        const futureDate = (parseInt(y) + 1) + '-' + m;
        const fi = codeToI[futureDate];
        if (fi !== undefined && processed[fi].index !== null) {
            processed[i].index = processed[fi].index / (1 + processed[fi].inflation / 100);
            backCalcCount++;
        }
    }

    // Replace any remaining nulls with 0
    processed.forEach(d => { if (d.index === null) d.index = 0; });

    console.log(`Processed ${processed.length} CPI data points (${backCalcCount} index values back-calculated)`);
    return processed;
}

/**
 * Main function - fetch and process all Tilastokeskus data
 */
async function fetchTilastokeskusData() {
    try {
        console.log('=== Fetching Tilastokeskus CPI data ===\n');

        const [inflationData, indexData] = await Promise.all([
            fetchInflationData(),
            fetchIndexData()
        ]);

        const cpiData = processCPIData(inflationData, indexData);

        console.log('\n=== Tilastokeskus data fetched successfully ===');
        console.log(`Total data points: ${cpiData.length}`);
        console.log(`Date range: ${cpiData[0].date} - ${cpiData[cpiData.length - 1].date}`);
        console.log(`Sample data:`, cpiData.slice(-3));

        return cpiData;

    } catch (error) {
        console.error('❌ Error fetching Tilastokeskus data:', error.message);
        throw error;
    }
}

// Export for use in other modules
module.exports = { fetchTilastokeskusData };

// Run if executed directly
if (require.main === module) {
    fetchTilastokeskusData()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
