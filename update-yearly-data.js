/**
 * Script to update yearly inflation data in index.html from Google Sheets
 * Checks if data has changed and updates HTML only if necessary
 */

const https = require('https');
const fs = require('fs');

const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
const RANGE = 'Raakadata!A1:B350';
const API_KEY = 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g';
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

// Fetch data from Google Sheets
function fetchSheetData() {
    return new Promise((resolve, reject) => {
        console.log('Making request to Google Sheets API...');
        https.get(API_URL, (res) => {
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
                        reject(new Error(`Google Sheets API error: ${json.error.message}`));
                        return;
                    }

                    if (!json.values) {
                        reject(new Error('No values field in API response'));
                        return;
                    }

                    console.log(`✓ Successfully fetched ${json.values.length} rows`);
                    resolve(json.values);
                } catch (e) {
                    reject(new Error(`Failed to parse JSON response: ${e.message}`));
                }
            });
        }).on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        });
    });
}

// Calculate yearly averages from monthly data
function calculateYearlyAverages(rawData) {
    const yearlyData = {};
    let processedRows = 0;

    rawData.forEach((row, index) => {
        // Skip header row
        if (index === 0 || !row[0] || !row[1]) return;

        const dateStr = row[0];
        const valueStr = row[1].toString();

        // Remove % sign and spaces, replace comma with period
        const cleanValue = valueStr.replace('%', '').replace(/\s/g, '').replace(',', '.');
        const value = parseFloat(cleanValue);

        if (isNaN(value)) {
            console.log(`Skipping row ${index}: invalid value "${valueStr}"`);
            return;
        }

        // Parse date (format: YYYY-MM)
        let year;
        if (dateStr.includes('-')) {
            // Format: YYYY-MM
            const parts = dateStr.split('-');
            year = parseInt(parts[0]);
        } else if (dateStr.includes('/')) {
            // Format: M/YYYY or MM/YYYY
            const parts = dateStr.split('/');
            year = parseInt(parts[1]);
        } else {
            console.log(`Skipping row ${index}: invalid date format "${dateStr}"`);
            return;
        }

        if (year < 2000 || year > 2030) return;

        if (!yearlyData[year]) {
            yearlyData[year] = { sum: 0, count: 0 };
        }

        yearlyData[year].sum += value;
        yearlyData[year].count++;
        processedRows++;
    });

    console.log(`Processed ${processedRows} valid data rows`);

    // Calculate averages
    const averages = {};
    for (const year in yearlyData) {
        const avg = yearlyData[year].sum / yearlyData[year].count;
        averages[year] = parseFloat(avg.toFixed(1));
    }

    console.log(`Calculated averages for ${Object.keys(averages).length} years`);

    return averages;
}

// Generate HTML for a year item
function generateYearItemHTML(year, value, isCurrentYear = false) {
    const arrow = value >= 0 ? '↑' : '↓';
    const arrowClass = value >= 0 ? 'up' : 'down';
    const valueClass = value >= 0 ? 'positive' : 'negative';
    const currentYearBadge = isCurrentYear ? '<span class="current-year-badge">Kuluva vuosi</span>' : '';
    const currentYearClass = isCurrentYear ? ' current-year-item' : '';

    if (isCurrentYear) {
        return `                    <div class="year-item${currentYearClass}">
                        ${currentYearBadge}
                        <span class="year">${year}</span>
                        <span class="value ${valueClass}">${value}% <span class="trend-arrow ${arrowClass}">${arrow}</span></span>
                    </div>`;
    } else {
        return `                    <div class="year-item"><span class="year">${year}</span><span class="value ${valueClass}">${value}% <span class="trend-arrow ${arrowClass}">${arrow}</span></span></div>`;
    }
}

// Update HTML file with new data
async function updateHTML() {
    console.log('Fetching data from Google Sheets...');

    // Fetch sheet data
    const rawData = await fetchSheetData();

    if (!rawData || rawData.length === 0) {
        throw new Error('No data received from Google Sheets');
    }

    console.log(`Received ${rawData.length} rows from Google Sheets`);

    const yearlyAverages = calculateYearlyAverages(rawData);

    if (!yearlyAverages || Object.keys(yearlyAverages).length === 0) {
        throw new Error('Failed to calculate yearly averages - no valid data found');
    }

    console.log('Yearly averages calculated:', yearlyAverages);

    // Read current HTML
    const htmlPath = './index.html';
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Find the compact-table-grid section
    const gridStartPattern = /<div class="compact-table-grid">/;
    const gridEndPattern = /<\/div>\s*<div class="show-more-container">/;

    const startMatch = html.match(gridStartPattern);
    if (!startMatch) {
        throw new Error('Could not find compact-table-grid in HTML');
    }

    const startIndex = startMatch.index + startMatch[0].length;
    const afterStart = html.substring(startIndex);
    const endMatch = afterStart.match(gridEndPattern);

    if (!endMatch) {
        throw new Error('Could not find end of compact-table-grid');
    }

    const endIndex = startIndex + endMatch.index;

    // Generate new HTML for the grid
    const currentYear = new Date().getFullYear();
    const years = Object.keys(yearlyAverages).map(Number).sort((a, b) => b - a);

    if (years.length < 6) {
        throw new Error(`Not enough years of data. Expected at least 6, got ${years.length}`);
    }

    // Visible years (most recent 6)
    const visibleYears = years.slice(0, 6);
    const olderYears = years.slice(6);

    console.log(`Processing ${visibleYears.length} visible years and ${olderYears.length} older years`);

    let newGridHTML = '\n';

    // Validate we have all the years we need
    if (!visibleYears[0] || !visibleYears[1] || !visibleYears[2] ||
        !visibleYears[3] || !visibleYears[4] || !visibleYears[5]) {
        throw new Error('Missing required year data in visibleYears array');
    }

    // Column 1: 2025, 2022 (or most recent 2 with gap)
    newGridHTML += '                <div class="year-column">\n';
    newGridHTML += generateYearItemHTML(visibleYears[0], yearlyAverages[visibleYears[0]], visibleYears[0] === currentYear) + '\n';
    newGridHTML += generateYearItemHTML(visibleYears[3], yearlyAverages[visibleYears[3]]) + '\n';
    newGridHTML += '                </div>\n';

    // Column 2: 2024, 2021
    newGridHTML += '                <div class="year-column">\n';
    newGridHTML += generateYearItemHTML(visibleYears[1], yearlyAverages[visibleYears[1]]) + '\n';
    newGridHTML += generateYearItemHTML(visibleYears[4], yearlyAverages[visibleYears[4]]) + '\n';
    newGridHTML += '                </div>\n';

    // Column 3: 2023, 2020
    newGridHTML += '                <div class="year-column">\n';
    newGridHTML += generateYearItemHTML(visibleYears[2], yearlyAverages[visibleYears[2]]) + '\n';
    newGridHTML += generateYearItemHTML(visibleYears[5], yearlyAverages[visibleYears[5]]) + '\n';
    newGridHTML += '                </div>\n';

    // Older years (hidden by default) - 2 years per column
    for (let i = 0; i < olderYears.length; i += 2) {
        newGridHTML += '                <div class="year-column older-years" style="display: none;">\n';
        newGridHTML += generateYearItemHTML(olderYears[i], yearlyAverages[olderYears[i]]) + '\n';
        if (olderYears[i + 1]) {
            newGridHTML += generateYearItemHTML(olderYears[i + 1], yearlyAverages[olderYears[i + 1]]) + '\n';
        }
        newGridHTML += '                </div>\n';
    }

    newGridHTML += '            ';

    // Replace the old grid content with new
    const before = html.substring(0, startIndex);
    const after = html.substring(endIndex);
    const newHTML = before + newGridHTML + after;

    // Check if anything changed
    if (html === newHTML) {
        console.log('No changes detected. HTML is already up to date.');
        return false;
    }

    // Write updated HTML
    fs.writeFileSync(htmlPath, newHTML, 'utf8');
    console.log('HTML updated successfully!');

    return true;
}

// Run the update
updateHTML()
    .then((updated) => {
        if (updated) {
            console.log('\n✓ Data has been updated in index.html');
            console.log('  You can now commit and push the changes.');
        } else {
            console.log('\n✓ No updates needed.');
        }
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error updating HTML:', error);
        process.exit(1);
    });
