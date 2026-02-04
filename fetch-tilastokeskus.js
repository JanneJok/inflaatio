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

    // Query: All months, Indeksisarja = "0_2015" (2015=100 baseline index)
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
                "code": "Indeksisarja",
                "selection": {
                    "filter": "item",
                    "values": ["0_2015"]
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

    const processed = [];

    // Convert month codes to labels (e.g., "2024M01" → "2024-01")
    Object.keys(monthLabels).forEach((monthCode, i) => {
        const monthLabel = monthLabels[monthCode];

        // Convert "2024M01" to "2024-01"
        const [year, month] = monthCode.split('M');
        const dateStr = `${year}-${month}`;

        const inflation = inflationValues[i];
        const index = indexValues[i] || null;

        if (inflation !== null && inflation !== undefined) {
            processed.push({
                date: dateStr,
                inflation: parseFloat(inflation),
                index: index !== null ? parseFloat(index) : 0
            });
        }
    });

    console.log(`Processed ${processed.length} CPI data points`);
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
