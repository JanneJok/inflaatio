// Configuration
const CONFIG = {
    SHEET_ID: '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8',
    API_KEY: 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g',
    HISTORICAL_RANGE: 'Raakadata!A:F', // Historical data for charts
    METRICS_RANGE: 'Key Metrics!A:B'    // Key metrics for tiles
};

// Global variables for data storage
let inflationData = [];
let keyMetrics = {};
let currentChartRange = '1v';

// Fetch data from Google Sheets
async function fetchInflationData() {
    try {
        showLoadingState();
        
        console.log('Fetching data from both sheets...');
        
        // Fetch both ranges simultaneously
        const [historicalResponse, metricsResponse] = await Promise.all([
            fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.HISTORICAL_RANGE}?key=${CONFIG.API_KEY}`),
            fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.METRICS_RANGE}?key=${CONFIG.API_KEY}`)
        ]);
        
        // Check historical data response
        if (!historicalResponse.ok) {
            const errorText = await historicalResponse.text();
            console.error('Historical data error:', errorText);
            throw new Error(`Historical data error: ${historicalResponse.status}`);
        }
        
        // Check metrics data response
        if (!metricsResponse.ok) {
            const errorText = await metricsResponse.text();
            console.error('Metrics data error:', errorText);
            throw new Error(`Metrics data error: ${metricsResponse.status}`);
        }
        
        const historicalData = await historicalResponse.json();
        const metricsData = await metricsResponse.json();
        
        console.log('Historical data:', historicalData);
        console.log('Metrics data:', metricsData);
        
        // Process historical data for charts
        if (historicalData.values && historicalData.values.length > 0) {
            inflationData = processHistoricalData(historicalData.values);
        }
        
        // Process key metrics for tiles
        if (metricsData.values && metricsData.values.length > 0) {
            keyMetrics = processKeyMetrics(metricsData.values);
        }
        
        updateUI();
        hideLoadingState();
        
        return { historical: inflationData, metrics: keyMetrics };
    } catch (error) {
        console.error('Error fetching data:', error);
        showErrorState(error.message);
        return null;
    }
}

// Process historical data (Raakadata sheet) for charts
function processHistoricalData(rawData) {
    const headers = rawData[0];
    const rows = rawData.slice(1);
    
    console.log('Historical headers:', headers);
    console.log('Historical sample row:', rows[0]);
    
    // Find column indices based on your exact structure
    const dateCol = headers.indexOf('Kuukausi');
    const inflationCol = headers.indexOf('Inflaatio %');
    const indexCol = headers.indexOf('Indeksi');
    
    console.log('Historical column indices:', { dateCol, inflationCol, indexCol });
    
    const processedData = rows.map(row => {
        const dateStr = row[dateCol] || '';
        const inflationStr = row[inflationCol] || '';
        const indexStr = row[indexCol] || '';
        
        const inflationValue = parseFloat(inflationStr.replace('%', '').replace(',', '.').trim());
        const indexValue = parseFloat(indexStr.replace(',', '.').trim());
        
        return {
            date: dateStr,
            inflation: isNaN(inflationValue) ? 0 : inflationValue,
            hicp: isNaN(indexValue) ? 0 : indexValue,
            monthlyChange: 0,
            rawRow: row
        };
    }).filter(item => {
        return item.date && 
               item.date.length > 0 && 
               !isNaN(item.inflation);
    });
    
    // Sort by date
    processedData.sort((a, b) => new Date(a.date + '-01') - new Date(b.date + '-01'));
    
    // Calculate monthly changes
    for (let i = 1; i < processedData.length; i++) {
        const current = processedData[i].inflation;
        const previous = processedData[i-1].inflation;
        processedData[i].monthlyChange = current - previous;
    }
    
    console.log('Historical processed data sample:', processedData.slice(-5));
    console.log('Total historical rows:', processedData.length);
    
    return processedData;
}

// Process key metrics data for tiles
function processKeyMetrics(rawData) {
    console.log('Processing key metrics data:', rawData);
    
    const metrics = {};
    
    // Skip header row and process data rows
    rawData.slice(1).forEach(row => {
        if (row.length >= 2) {
            const key = row[0]; // Column A - metric name
            const value = row[1]; // Column B - metric value
            
            if (key && value) {
                // Clean the value - remove % and convert to number if it's a percentage
                let cleanValue = value;
                if (typeof value === 'string' && value.includes('%')) {
                    cleanValue = parseFloat(value.replace('%', '').replace(',', '.').trim());
                } else if (typeof value === 'string') {
                    // Try to parse as number
                    const numValue = parseFloat(value.replace(',', '.').trim());
                    cleanValue = isNaN(numValue) ? value : numValue;
                }
                
                metrics[key] = cleanValue;
            }
        }
    });
    
    console.log('Processed key metrics:', metrics);
    return metrics;
}

// Helper function to find column index by possible names
function findColumnIndex(headers, possibleNames) {
    for (let name of possibleNames) {
        const index = headers.findIndex(header => 
            header.toLowerCase().includes(name.toLowerCase())
        );
        if (index !== -1) return index;
    }
    return 0; // Default to first column if not found
}

// Update all UI elements with fresh data
function updateUI() {
    if (!inflationData.length) return;
    
    updateCarouselTiles();
    updateCharts();
    updateLastUpdated();
}

// Update carousel tiles with real data from Key Metrics
function updateCarouselTiles() {
    console.log('Updating carousel tiles with metrics:', keyMetrics);
    
    if (!keyMetrics || Object.keys(keyMetrics).length === 0) {
        console.log('No key metrics available, skipping tile update');
        return;
    }
    
    // Map the metrics to tiles based on your sheet structure
    const tileMapping = [
        {
            selector: '.tile:nth-child(1) .highlight',
            key: 'Viimeisin inflaatio', // This should match the Finnish text in your sheet
            fallbackKey: 'Latest inflation' // Fallback if English is used
        },
        {
            selector: '.tile:nth-child(2) .highlight',
            key: 'Muutos edelliseen kuukauteen',
            fallbackKey: 'Monthly change'
        },
        {
            selector: '.tile:nth-child(3) .highlight',
            key: '12 kk keskiarvo',
            fallbackKey: '12 month average'
        },
        {
            selector: '.tile:nth-child(4) .highlight',
            key: 'Vuoden alun keskiarvo',
            fallbackKey: 'Year to date average'
        },
        {
            selector: '.tile:nth-child(5) .highlight',
            key: 'Sama kuukausi vuotta aiemmin',
            fallbackKey: 'Same month last year'
        }
    ];
    
    tileMapping.forEach((tile, index) => {
        const element = document.querySelector(tile.selector);
        if (!element) return;
        
        // Try to find the metric value using different possible keys
        let value = keyMetrics[tile.key] || keyMetrics[tile.fallbackKey];
        
        // If not found, try to find by index position (since your image shows 6 rows)
        if (value === undefined) {
            const keys = Object.keys(keyMetrics);
            if (keys[index + 1]) { // +1 to skip header row
                value = keyMetrics[keys[index + 1]];
            }
        }
        
        if (value !== undefined) {
            const formattedValue = formatTileValue(value);
            element.textContent = formattedValue;
            element.className = `highlight ${getValueClass(typeof value === 'number' ? value : 0)}`;
            
            console.log(`Updated tile ${index + 1}: ${tile.key} = ${formattedValue}`);
        } else {
            element.textContent = 'N/A';
            element.className = 'highlight neutral';
            console.log(`No value found for tile ${index + 1}: ${tile.key}`);
        }
    });
}

// Format values for tile display
function formatTileValue(value) {
    if (typeof value === 'number') {
        const symbol = value > 0 ? '▲' : value < 0 ? '▼' : '';
        return `${symbol} ${Math.abs(value).toFixed(1)}%`;
    } else if (typeof value === 'string' && value.includes('%')) {
        // Already formatted with %
        const numValue = parseFloat(value.replace('%', '').replace(',', '.'));
        if (!isNaN(numValue)) {
            const symbol = numValue > 0 ? '▲' : numValue < 0 ? '▼' : '';
            return `${symbol} ${value}`;
        }
    }
    return value.toString();
}

// Format values for display (keep old function for charts)
function formatValue(value, format) {
    if (format === 'percentage') {
        const symbol = value > 0 ? '▲' : value < 0 ? '▼' : '';
        return `${symbol} ${Math.abs(value).toFixed(1)}%`;
    }
    return value.toFixed(1);
}

// Get CSS class based on value
function getValueClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
}

// Update charts with real data
function updateCharts() {
    const filteredData = filterDataByRange(inflationData, currentChartRange);
    
    updateInflationChart(filteredData);
    updateHICPChart(filteredData);
}

// Filter data based on time range
function filterDataByRange(data, range) {
    if (!data || data.length === 0) return [];
    
    const now = new Date();
    let startDate = new Date();
    
    switch (range) {
        case '6kk':
            startDate.setMonth(now.getMonth() - 6);
            break;
        case '1v':
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        case '3v':
            startDate.setFullYear(now.getFullYear() - 3);
            break;
        case '5v':
            startDate.setFullYear(now.getFullYear() - 5);
            break;
        case 'Max':
            return data;
    }
    
    return data.filter(d => {
        // Convert "YYYY-MM" format to date for comparison
        const itemDate = new Date(d.date + '-01');
        return itemDate >= startDate;
    });
}

// Format date for chart display
function formatDateForChart(dateString) {
    // dateString is in format "YYYY-MM", convert to readable format
    const [year, month] = dateString.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('fi-FI', { 
        year: '2-digit', 
        month: '2-digit' 
    });
}

// Update inflation chart
function updateInflationChart(data) {
    const canvas = document.getElementById('inflationChart');
    if (!canvas || !window.inflationChart) return;
    
    const labels = data.map(d => formatDateForChart(d.date));
    const values = data.map(d => d.inflation);
    
    window.inflationChart.data.labels = labels;
    window.inflationChart.data.datasets[0].data = values;
    window.inflationChart.update();
    
    // Update chart statistics
    updateChartStats('inflation', values);
}

// Update HICP chart
function updateHICPChart(data) {
    const canvas = document.getElementById('hicpChart');
    if (!canvas || !window.hicpChart) return;
    
    const labels = data.map(d => formatDateForChart(d.date));
    const values = data.map(d => d.hicp);
    
    window.hicpChart.data.labels = labels;
    window.hicpChart.data.datasets[0].data = values;
    window.hicpChart.update();
    
    // Update chart statistics
    updateChartStats('hicp', values, data);
}

// Update chart statistics
function updateChartStats(chartType, values, data = null) {
    if (!values || values.length === 0) return;
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    if (chartType === 'inflation') {
        const chartElement = document.querySelector('#inflationChart').closest('.chart');
        const statsElements = chartElement.querySelectorAll('.chart-stats p');
        if (statsElements[0]) statsElements[0].innerHTML = `<span class="percentage-badge">🔵</span> Minimi ${min.toFixed(1)}%`;
        if (statsElements[1]) statsElements[1].innerHTML = `<span class="percentage-badge">🟡</span> Keskiarvo ${avg.toFixed(1)}%`;
        if (statsElements[2]) statsElements[2].innerHTML = `<span class="percentage-badge">🔴</span> Maksimi ${max.toFixed(1)}%`;
    } else if (chartType === 'hicp' && data && data.length > 0) {
        const latest = data[data.length - 1];
        
        // Find data from approximately 12 months ago
        const yearAgo = data.find(d => {
            const latestDateParts = latest.date.split('-');
            const dataDateParts = d.date.split('-');
            const latestYear = parseInt(latestDateParts[0]);
            const latestMonth = parseInt(latestDateParts[1]);
            const dataYear = parseInt(dataDateParts[0]);
            const dataMonth = parseInt(dataDateParts[1]);
            
            return (latestYear - dataYear === 1) && (latestMonth === dataMonth);
        });
        
        const yearlyChange = yearAgo ? ((latest.hicp - yearAgo.hicp) / yearAgo.hicp) * 100 : 0;
        
        const chartElement = document.querySelector('#hicpChart').closest('.chart');
        const statsElements = chartElement.querySelectorAll('.chart-stats p');
        if (statsElements[0]) statsElements[0].innerHTML = `<span class="percentage-badge">📈</span> Nousutahti ${latest.inflation > 0 ? '+' : ''}${latest.inflation.toFixed(1)}%`;
        if (statsElements[1]) statsElements[1].innerHTML = `<span class="percentage-badge">📊</span> Indeksiarvo ${latest.hicp.toFixed(2)}`;
        if (statsElements[2]) statsElements[2].innerHTML = `<span class="percentage-badge">📅</span> Vuosimuutos ${yearlyChange > 0 ? '+' : ''}${yearlyChange.toFixed(1)}%`;
    }
}

// Update last updated timestamp
function updateLastUpdated() {
    const now = new Date().toLocaleString('fi-FI');
    let element = document.querySelector('.last-updated');
    
    if (!element) {
        element = document.createElement('p');
        element.className = 'last-updated';
        element.style.cssText = 'text-align: center; color: rgba(255,255,255,0.6); font-size: 0.875rem; margin-top: 2rem;';
        document.querySelector('.container').appendChild(element);
    }
    
    element.textContent = `Päivitetty: ${now}`;
}

// Loading and error states
function showLoadingState() {
    document.querySelectorAll('.tile .highlight').forEach(el => {
        el.textContent = '...';
        el.className = 'highlight neutral';
    });
}

function hideLoadingState() {
    // Loading state is automatically hidden when data updates
}

function showErrorState(message) {
    console.error('Data fetch error:', message);
    
    // Show error in tiles
    document.querySelectorAll('.tile .highlight').forEach(el => {
        el.textContent = 'Virhe';
        el.className = 'highlight negative';
    });
    
    // Add error message
    let errorElement = document.querySelector('.error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.style.cssText = 'background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); padding: 1rem; border-radius: 8px; margin: 1rem 0; text-align: center; color: #ef4444;';
        document.querySelector('.hero-section').after(errorElement);
    }
    
    errorElement.innerHTML = `
        <strong>Tietojen lataus epäonnistui</strong><br>
        <small>${message}</small><br>
        <button onclick="retryDataFetch()" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.5); border-radius: 4px; color: white; cursor: pointer;">Yritä uudelleen</button>
    `;
}

// Retry function for error recovery
function retryDataFetch() {
    const errorElement = document.querySelector('.error-message');
    if (errorElement) errorElement.remove();
    
    fetchInflationData();
}

// Initialize charts (updated from original code)
function initializeCharts() {
    const chartConfig = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                titleColor: '#1a2847',
                bodyColor: '#6b7280',
                borderColor: 'rgba(42, 123, 160, 0.3)',
                borderWidth: 1,
                cornerRadius: 8,
                displayColors: false,
                padding: 12
            }
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)',
                    maxRotation: 45,
                    minRotation: 45,
                    font: {
                        size: window.innerWidth < 400 ? 9 : 11
                    }
                }
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)',
                    callback: function(value) {
                        return value + '%';
                    },
                    font: {
                        size: window.innerWidth < 400 ? 9 : 11
                    }
                }
            }
        },
        layout: {
            padding: {
                left: 0,
                right: 0,
                top: 10,
                bottom: 0
            }
        }
    };

    // Initialize Inflation Chart
    const inflationCanvas = document.getElementById('inflationChart');
    if (inflationCanvas) {
        const inflationCtx = inflationCanvas.getContext('2d');
        window.inflationChart = new Chart(inflationCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: '#4ca5ba',
                    backgroundColor: 'rgba(76, 165, 186, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#b8d4e3',
                    pointBorderColor: '#2a7ba0',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: chartConfig
        });
    }

    // Initialize HICP Chart
    const hicpCanvas = document.getElementById('hicpChart');
    if (hicpCanvas) {
        const hicpCtx = hicpCanvas.getContext('2d');
        window.hicpChart = new Chart(hicpCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: '#3891a6',
                    backgroundColor: 'rgba(56, 145, 166, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#b8d4e3',
                    pointBorderColor: '#1e5a7d',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                ...chartConfig,
                scales: {
                    ...chartConfig.scales,
                    y: {
                        ...chartConfig.scales.y,
                        ticks: {
                            ...chartConfig.scales.y.ticks,
                            callback: function(value) {
                                return value.toFixed(0);
                            }
                        }
                    }
                }
            }
        });
    }
}

// Enhanced DOM loaded event
document.addEventListener('DOMContentLoaded', () => {
    // Original carousel functionality
    const carousel = document.querySelector('.carousel-inner');
    const leftArrow = document.querySelector('.arrow-left');
    const rightArrow = document.querySelector('.arrow-right');

    if (carousel && leftArrow && rightArrow) {
        leftArrow.addEventListener('click', () => {
            carousel.scrollBy({ left: -330, behavior: 'smooth' });
        });

        rightArrow.addEventListener('click', () => {
            carousel.scrollBy({ left: 330, behavior: 'smooth' });
        });
    }

    // Smooth scrolling for navigation
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Enhanced chart time range buttons
    document.querySelectorAll('.chart-controls button').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from siblings
            this.parentElement.querySelectorAll('button').forEach(b => {
                b.classList.remove('active');
            });
            // Add active class to clicked button
            this.classList.add('active');
            
            // Update current range and refresh charts
            currentChartRange = this.textContent;
            if (inflationData.length > 0) {
                updateCharts();
            }
        });
    });

    // Initialize first button as active in each chart
    document.querySelectorAll('.chart-controls').forEach(controls => {
        const firstBtn = controls.querySelector('button');
        if (firstBtn) {
            firstBtn.classList.add('active');
            currentChartRange = firstBtn.textContent;
        }
    });

    // Initialize charts
    if (typeof Chart !== 'undefined') {
        initializeCharts();
    }

    // Fetch initial data
    fetchInflationData();
    
    // Set up auto-refresh every 5 minutes
    setInterval(fetchInflationData, 5 * 60 * 1000);
});