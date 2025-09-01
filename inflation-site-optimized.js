// Configuration
const CONFIG = {
    SHEET_ID: '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8',
    API_KEY: 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g',
    HISTORICAL_RANGE: 'Raakadata!A:F',
    METRICS_RANGE: 'Key Metrics!A:B',
    CACHE_DURATION: 5 * 60 * 1000
};

// Global variables
let inflationData = [];
let keyMetrics = {};
let chartInstances = {};
let dataCache = new Map();
let lastFetch = 0;

// Chart ranges for independent control
let currentInflationRange = '5v';
let currentHicpRange = '5v';

// Fetch inflation data with caching
async function fetchInflationData() {
    const cacheKey = 'inflation_data';
    const now = Date.now();
    
    // Check cache
    if (dataCache.has(cacheKey) && (now - lastFetch) < CONFIG.CACHE_DURATION) {
        const cachedData = dataCache.get(cacheKey);
        inflationData = cachedData.historical || [];
        keyMetrics = cachedData.metrics || {};
        updateUI();
        return cachedData;
    }

    try {
        console.log('🔄 Fetching fresh data...');
        
        const [historicalRes, metricsRes] = await Promise.all([
            fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.HISTORICAL_RANGE}?key=${CONFIG.API_KEY}`),
            fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.METRICS_RANGE}?key=${CONFIG.API_KEY}`)
        ]);

        const historicalData = historicalRes.ok ? await historicalRes.json() : null;
        const metricsData = metricsRes.ok ? await metricsRes.json() : null;

        // Process historical data
        if (historicalData?.values?.length > 1) {
            inflationData = processHistoricalData(historicalData.values);
        }

        // Process metrics data
        if (metricsData?.values?.length > 1) {
            keyMetrics = processKeyMetrics(metricsData.values);
        }

        // Cache results
        const processedData = { historical: inflationData, metrics: keyMetrics };
        dataCache.set(cacheKey, processedData);
        lastFetch = now;

        updateUI();
        return processedData;

    } catch (error) {
        console.error('❌ Data fetch error:', error);
        showErrorState(error.message);
        return null;
    }
}

// Process historical data
function processHistoricalData(rawData) {
    const headers = rawData[0];
    const rows = rawData.slice(1);
    
    const dateCol = headers.indexOf('Kuukausi');
    const inflationCol = headers.indexOf('Inflaatio %');
    const indexCol = headers.indexOf('Indeksi');
    
    const processedData = rows.map(row => {
        const dateStr = row[dateCol] || '';
        const inflationStr = row[inflationCol] || '';
        const indexStr = row[indexCol] || '';
        
        const inflationValue = parseFloat(inflationStr.replace('%', '').replace(',', '.').trim());
        const indexValue = parseFloat(indexStr.replace(',', '.').trim());
        
        return {
            date: dateStr,
            inflation: isNaN(inflationValue) ? 0 : inflationValue,
            hicp: isNaN(indexValue) ? 0 : indexValue
        };
    }).filter(item => item.date && !isNaN(item.inflation));
    
    return processedData.sort((a, b) => new Date(a.date + '-01') - new Date(b.date + '-01'));
}

// Process key metrics
function processKeyMetrics(rawData) {
    const metrics = {};
    rawData.slice(1).forEach(row => {
        if (row.length >= 2 && row[0] && row[1]) {
            const key = row[0].toString().trim();
            const value = row[1].toString().trim();
            metrics[key] = value;
        }
    });
    return metrics;
}

// Filter data based on time range
function filterDataByRange(data, range) {
    if (!data || data.length === 0) return [];
    if (range === 'Max') return data;
    
    const now = new Date();
    const startDate = new Date();
    
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
    }
    
    return data.filter(d => {
        const itemDate = new Date(d.date + '-01');
        return itemDate >= startDate;
    });
}

// Update UI
function updateUI() {
    console.log('🔄 Updating UI...');
    
    // Always try to update tiles from keyMetrics
    updateCarouselTiles();
    
    // Only update charts if we have historical data
    if (inflationData && inflationData.length > 0) {
        updateCharts();
    } else {
        console.log('⚠️ No historical data available for charts');
    }
    
    updateLastUpdated();
}

// Update carousel tiles
function updateCarouselTiles() {
    console.log('📊 Updating tiles with metrics:', keyMetrics);
    
    if (!keyMetrics || Object.keys(keyMetrics).length === 0) {
        console.log('No metrics available, skipping tile update');
        return;
    }
    
    const tiles = document.querySelectorAll('.tile .highlight');
    const metricKeys = Object.keys(keyMetrics);
    
    console.log('Available metrics:', metricKeys);
    
    tiles.forEach((tile, index) => {
        if (index < metricKeys.length) {
            const key = metricKeys[index];
            const value = keyMetrics[key];
            console.log(`Updating tile ${index + 1}: ${key} = ${value}`);
            
            tile.textContent = value;
            
            // Determine color based on value
            if (typeof value === 'string' && value.includes('%')) {
                const numValue = parseFloat(value.replace('%', '').replace(',', '.'));
                if (!isNaN(numValue)) {
                    if (numValue > 0) {
                        tile.className = 'highlight positive';
                    } else if (numValue < 0) {
                        tile.className = 'highlight negative';
                    } else {
                        tile.className = 'highlight neutral';
                    }
                } else {
                    tile.className = 'highlight neutral';
                }
            } else {
                tile.className = 'highlight positive';
            }
        } else {
            tile.textContent = 'N/A';
            tile.className = 'highlight neutral';
        }
    });
    
    console.log('✅ Tiles updated successfully');
}

// Update charts with specific ranges
function updateCharts() {
    console.log('📊 Updating charts...');
    
    if (inflationData.length === 0) {
        console.log('No inflation data available');
        return;
    }
    
    // Update inflation chart with its own range
    if (chartInstances.inflation) {
        console.log('Updating inflation chart with range:', currentInflationRange);
        const inflationFiltered = filterDataByRange(inflationData, currentInflationRange);
        updateInflationChart(inflationFiltered);
    }

    // Update HICP chart with its own range
    if (chartInstances.hicp) {
        console.log('Updating HICP chart with range:', currentHicpRange);
        const hicpFiltered = filterDataByRange(inflationData, currentHicpRange);
        updateHicpChart(hicpFiltered); // FIXED: Using correct function name
    }
    
    console.log('✅ Charts updated');
}

// Update inflation chart specifically
function updateInflationChart(data) {
    if (!data || data.length === 0) {
        console.log('No inflation data to update');
        return;
    }
    
    const labels = data.map(d => d.date.substr(2)); // Show YY-MM format
    const values = data.map(d => d.inflation);
    
    chartInstances.inflation.data.labels = labels;
    chartInstances.inflation.data.datasets[0].data = values;
    chartInstances.inflation.update();
    
    // Update stats
    if (values.length > 0) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        
        updateElement('#inflation-min', `Minimi ${min.toFixed(1)}%`);
        updateElement('#inflation-avg', `Keskiarvo ${avg.toFixed(1)}%`);
        updateElement('#inflation-max', `Maksimi ${max.toFixed(1)}%`);
    }
}

// Update HICP chart - CORRECTED VERSION
function updateHicpChart(data) {
    if (!data || data.length === 0) {
        console.log('No HICP data to update');
        return;
    }
    
    console.log('Updating HICP chart with', data.length, 'data points');
    
    const labels = data.map(d => d.date.substr(2)); // Show YY-MM format
    const values = data.map(d => d.hicp);
    
    if (chartInstances.hicp) {
        chartInstances.hicp.data.labels = labels;
        chartInstances.hicp.data.datasets[0].data = values;
        chartInstances.hicp.update();
        
        // Update stats safely
        const latest = data[data.length - 1];
        if (latest) {
            updateElement('#hicp-trend', `Nousutahti ${latest.inflation.toFixed(1)}%`);
            updateElement('#hicp-value', `Indeksiarvo ${latest.hicp.toFixed(2)}`);
            
            // Simple yearly change - just use 12 months back if available
            if (data.length >= 12) {
                const twelveMonthsAgo = data[data.length - 12];
                const yearlyChange = ((latest.hicp - twelveMonthsAgo.hicp) / twelveMonthsAgo.hicp) * 100;
                updateElement('#hicp-change', `Vuosimuutos ${yearlyChange.toFixed(1)}%`);
            } else {
                updateElement('#hicp-change', `Vuosimuutos ${latest.inflation.toFixed(1)}%`);
            }
        }
        
        console.log('✅ HICP chart updated successfully');
    }
}

// Initialize charts
function initializeCharts() {
    const chartConfig = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
                ticks: { color: 'rgba(255, 255, 255, 0.7)' }
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
                ticks: { 
                    color: 'rgba(255, 255, 255, 0.7)',
                    callback: function(value) { return value + '%'; }
                }
            }
        }
    };

    // Initialize inflation chart
    const inflationCanvas = document.getElementById('inflationChart');
    if (inflationCanvas) {
        hideChartLoading(inflationCanvas);
        const ctx = inflationCanvas.getContext('2d');
        chartInstances.inflation = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: '#4ca5ba',
                    backgroundColor: 'rgba(76, 165, 186, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: chartConfig
        });
    }

    // Initialize HICP chart
    const hicpCanvas = document.getElementById('hicpChart');
    if (hicpCanvas) {
        hideChartLoading(hicpCanvas);
        const ctx = hicpCanvas.getContext('2d');
        chartInstances.hicp = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: '#3891a6',
                    backgroundColor: 'rgba(56, 145, 166, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
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
                            callback: function(value) { return value.toFixed(0); }
                        }
                    }
                }
            }
        });
    }

    // Update charts with current data
    if (inflationData.length > 0) {
        updateCharts();
    }
}

// Hide chart loading indicator
function hideChartLoading(canvas) {
    const placeholder = canvas.closest('.chart-placeholder');
    const loadingDiv = placeholder.querySelector('div');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
    canvas.style.display = 'block';
}

// Update element text
function updateElement(selector, text) {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = text;
    }
}

// Show error state
function showErrorState(message) {
    console.error('💥 Error:', message);
    
    // Update tiles with error state
    document.querySelectorAll('.tile .highlight').forEach(el => {
        el.textContent = 'Virhe';
        el.className = 'highlight negative';
    });
    
    // Show error message
    let errorElement = document.querySelector('.error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        document.querySelector('.hero-section').after(errorElement);
    }
    
    errorElement.innerHTML = `
        <strong>Tietojen lataus epäonnistui</strong><br>
        <small>${message}</small><br>
        <button onclick="retryDataFetch()" style="
            margin-top: 0.5rem;
            padding: 0.5rem 1rem;
            background: rgba(239,68,68,0.2);
            border: 1px solid rgba(239,68,68,0.5);
            border-radius: 4px;
            color: white;
            cursor: pointer;
        ">Yritä uudelleen</button>
    `;
}

// Retry data fetch
function retryDataFetch() {
    const errorElement = document.querySelector('.error-message');
    if (errorElement) errorElement.remove();
    
    // Clear cache and force refresh
    dataCache.clear();
    fetchInflationData();
}

// Update last updated timestamp
function updateLastUpdated() {
    const now = new Date().toLocaleString('fi-FI');
    let element = document.querySelector('.last-updated');
    
    if (!element) {
        element = document.createElement('p');
        element.className = 'last-updated';
        document.querySelector('.container').appendChild(element);
    }
    
    element.textContent = `Päivitetty: ${now}`;
}

// Chart time range handling with independent controls
function setupChartControls() {
    // Get both chart control sections
    const charts = document.querySelectorAll('.chart');
    
    charts.forEach((chart, chartIndex) => {
        const controls = chart.querySelectorAll('.chart-controls button');
        const chartType = chartIndex === 0 ? 'inflation' : 'hicp';
        
        controls.forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active from siblings in this chart only
                this.parentElement.querySelectorAll('button').forEach(b => {
                    b.classList.remove('active');
                });
                
                // Add active to clicked button
                this.classList.add('active');
                
                // Get the selected range
                const selectedRange = this.getAttribute('data-range');
                
                // Update the appropriate range variable
                if (chartType === 'inflation') {
                    currentInflationRange = selectedRange;
                    console.log('📊 Inflation chart range changed to:', selectedRange);
                    
                    // Update only inflation chart
                    if (chartInstances.inflation && inflationData.length > 0) {
                        const filteredData = filterDataByRange(inflationData, currentInflationRange);
                        updateInflationChart(filteredData);
                    }
                } else {
                    currentHicpRange = selectedRange;
                    console.log('📊 HICP chart range changed to:', selectedRange);
                    
                    // Update only HICP chart
                    if (chartInstances.hicp && inflationData.length > 0) {
                        const filteredData = filterDataByRange(inflationData, currentHicpRange);
                        updateHicpChart(filteredData); // FIXED: Using correct function name
                    }
                }
            });
        });
    });
}

// Carousel functionality
function setupCarousel() {
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
}

// Navigation smooth scrolling
function setupNavigation() {
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
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing application...');
    
    // Setup UI interactions immediately
    setupNavigation();
    setupCarousel();
    setupChartControls();
    
    try {
        // Load Chart.js if not already loaded
        if (typeof Chart === 'undefined') {
            console.log('📊 Loading Chart.js...');
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        // Initialize charts
        initializeCharts();
        
        // Fetch initial data
        await fetchInflationData();
        
        // Set up auto-refresh every 5 minutes
        setInterval(fetchInflationData, CONFIG.CACHE_DURATION);
        
        console.log('✅ Application initialized successfully');
        
    } catch (error) {
        console.error('💥 Initialization failed:', error);
        showErrorState('Sovelluksen alustus epäonnistui: ' + error.message);
    }
});

// Expose retry function globally
window.retryDataFetch = retryDataFetch;