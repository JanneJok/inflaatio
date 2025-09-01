// Optimized JavaScript with performance improvements
// Configuration
const CONFIG = {
    SHEET_ID: '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8',
    API_KEY: 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g',
    HISTORICAL_RANGE: 'Raakadata!A:F',
    METRICS_RANGE: 'Key Metrics!A:B',
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
};

// Global variables with better memory management
let inflationData = [];
let keyMetrics = {};
let currentChartRange = '1v';
let chartInstances = {};
let dataCache = new Map();
let lastFetch = 0;

// Performance monitoring
const performance = {
    start: Date.now(),
    marks: {},
    
    mark(name) {
        this.marks[name] = Date.now();
        if (typeof window !== 'undefined' && window.performance) {
            window.performance.mark(name);
        }
    },
    
    measure(name, startMark, endMark) {
        const start = this.marks[startMark] || this.start;
        const end = this.marks[endMark] || Date.now();
        const duration = end - start;
        
        console.log(`⏱️ ${name}: ${duration}ms`);
        
        if (typeof window !== 'undefined' && window.performance) {
            window.performance.measure(name, startMark, endMark);
        }
        
        return duration;
    }
};

// Optimized data fetching with caching and retry logic
async function fetchInflationData(forceRefresh = false) {
    const cacheKey = 'inflation_data';
    const now = Date.now();
    
    // Check cache first
    if (!forceRefresh && dataCache.has(cacheKey) && (now - lastFetch) < CONFIG.CACHE_DURATION) {
        console.log('📦 Using cached data');
        const cachedData = dataCache.get(cacheKey);
        inflationData = cachedData.historical;
        keyMetrics = cachedData.metrics;
        updateUI();
        return cachedData;
    }
    
    performance.mark('fetch-start');
    
    try {
        showLoadingState();
        console.log('🔄 Fetching fresh data from Google Sheets...');
        
        // Use Promise.allSettled for better error handling
        const [historicalResult, metricsResult] = await Promise.allSettled([
            fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.HISTORICAL_RANGE}?key=${CONFIG.API_KEY}`),
            fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.METRICS_RANGE}?key=${CONFIG.API_KEY}`)
        ]);
        
        // Handle partial failures gracefully
        let historicalData = null;
        let metricsData = null;
        
        if (historicalResult.status === 'fulfilled') {
            historicalData = await historicalResult.value.json();
        } else {
            console.error('❌ Historical data fetch failed:', historicalResult.reason);
        }
        
        if (metricsResult.status === 'fulfilled') {
            metricsData = await metricsResult.value.json();
        } else {
            console.error('❌ Metrics data fetch failed:', metricsResult.reason);
        }
        
        // Process data if available
        if (historicalData?.values?.length > 0) {
            inflationData = processHistoricalData(historicalData.values);
        }
        
        if (metricsData?.values?.length > 0) {
            keyMetrics = processKeyMetrics(metricsData.values);
        }
        
        // Cache the results
        const processedData = { historical: inflationData, metrics: keyMetrics };
        dataCache.set(cacheKey, processedData);
        lastFetch = now;
        
        performance.mark('fetch-end');
        performance.measure('Data Fetch', 'fetch-start', 'fetch-end');
        
        updateUI();
        hideLoadingState();
        
        return processedData;
        
    } catch (error) {
        console.error('💥 Error fetching data:', error);
        showErrorState(error.message);
        return null;
    }
}

// Retry mechanism with exponential backoff
async function fetchWithRetry(url, attempts = CONFIG.RETRY_ATTEMPTS) {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            console.warn(`🔄 Fetch attempt ${i + 1}/${attempts} failed:`, error.message);
            
            if (i === attempts - 1) {
                throw error;
            }
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * Math.pow(2, i)));
        }
    }
}

// Optimized data processing with better error handling
function processHistoricalData(rawData) {
    performance.mark('process-historical-start');
    
    if (!rawData || rawData.length < 2) {
        console.warn('⚠️ Insufficient historical data');
        return [];
    }
    
    const headers = rawData[0];
    const rows = rawData.slice(1);
    
    // More robust column detection
    const dateCol = findColumn(headers, ['kuukausi', 'date', 'month']);
    const inflationCol = findColumn(headers, ['inflaatio %', 'inflation', 'rate']);
    const indexCol = findColumn(headers, ['indeksi', 'index', 'hicp']);
    
    if (dateCol === -1 || inflationCol === -1) {
        throw new Error('Required columns not found in historical data');
    }
    
    const processedData = rows.reduce((acc, row, index) => {
        try {
            const item = processDataRow(row, dateCol, inflationCol, indexCol);
            if (item && item.date && !isNaN(item.inflation)) {
                acc.push(item);
            }
        } catch (error) {
            console.warn(`⚠️ Skipping row ${index + 2}:`, error.message);
        }
        return acc;
    }, []);
    
    // Sort and calculate changes efficiently
    processedData.sort((a, b) => new Date(a.date + '-01') - new Date(b.date + '-01'));
    
    // Calculate monthly changes in a single pass
    for (let i = 1; i < processedData.length; i++) {
        processedData[i].monthlyChange = processedData[i].inflation - processedData[i - 1].inflation;
    }
    
    performance.mark('process-historical-end');
    performance.measure('Historical Data Processing', 'process-historical-start', 'process-historical-end');
    
    console.log(`✅ Processed ${processedData.length} historical records`);
    return processedData;
}

// Helper function for robust column detection
function findColumn(headers, possibleNames) {
    return headers.findIndex(header => 
        possibleNames.some(name => 
            header.toLowerCase().includes(name.toLowerCase())
        )
    );
}

// Helper function for processing individual data rows
function processDataRow(row, dateCol, inflationCol, indexCol) {
    const dateStr = row[dateCol]?.toString().trim() || '';
    const inflationStr = row[inflationCol]?.toString().trim() || '';
    const indexStr = indexCol !== -1 ? row[indexCol]?.toString().trim() || '' : '';
    
    if (!dateStr || !inflationStr) {
        return null;
    }
    
    // More robust number parsing
    const inflationValue = parseNumericValue(inflationStr);
    const indexValue = indexStr ? parseNumericValue(indexStr) : 0;
    
    return {
        date: dateStr,
        inflation: inflationValue,
        hicp: indexValue,
        monthlyChange: 0
    };
}

// Robust numeric value parsing
function parseNumericValue(str) {
    if (!str) return 0;
    
    // Handle different formats: "1.5%", "1,5 %", "1.5", etc.
    const cleaned = str
        .replace(/[%\s]/g, '')  // Remove % and spaces
        .replace(/,/g, '.')      // Replace comma with dot
        .trim();
    
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

// Optimized key metrics processing
function processKeyMetrics(rawData) {
    performance.mark('process-metrics-start');
    
    if (!rawData || rawData.length < 2) {
        console.warn('⚠️ Insufficient metrics data');
        return {};
    }
    
    const metrics = {};
    
    // Skip header and process data rows
    rawData.slice(1).forEach((row, index) => {
        try {
            if (row.length >= 2 && row[0] && row[1]) {
                const key = row[0].toString().trim();
                const value = parseNumericValue(row[1].toString());
                
                if (key && !isNaN(value)) {
                    metrics[key] = value;
                }
            }
        } catch (error) {
            console.warn(`⚠️ Skipping metrics row ${index + 2}:`, error.message);
        }
    });
    
    performance.mark('process-metrics-end');
    performance.measure('Metrics Processing', 'process-metrics-start', 'process-metrics-end');
    
    console.log(`✅ Processed ${Object.keys(metrics).length} key metrics`);
    return metrics;
}

// Optimized UI updates with batch DOM operations
function updateUI() {
    performance.mark('ui-update-start');
    
    // Use requestAnimationFrame for smooth UI updates
    requestAnimationFrame(() => {
        updateCarouselTiles();
        
        // Only update charts if they're visible (intersection observer could be added)
        if (isElementVisible(document.querySelector('.charts'))) {
            updateCharts();
        }
        
        updateLastUpdated();
        
        performance.mark('ui-update-end');
        performance.measure('UI Update', 'ui-update-start', 'ui-update-end');
    });
}

// Check if element is visible in viewport
function isElementVisible(element) {
    if (!element) return false;
    
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

// Optimized carousel tile updates with error handling
function updateCarouselTiles() {
    if (!keyMetrics || Object.keys(keyMetrics).length === 0) {
        console.log('📝 No key metrics available for tiles');
        return;
    }
    
    // Batch DOM updates
    const updates = [];
    const tileSelectors = [
        '.tile:nth-child(1) .highlight',
        '.tile:nth-child(2) .highlight', 
        '.tile:nth-child(3) .highlight',
        '.tile:nth-child(4) .highlight',
        '.tile:nth-child(5) .highlight'
    ];
    
    // Prepare all updates first
    tileSelectors.forEach((selector, index) => {
        const element = document.querySelector(selector);
        if (!element) return;
        
        // Try to find matching metric value
        const metricKeys = Object.keys(keyMetrics);
        const value = index < metricKeys.length ? keyMetrics[metricKeys[index]] : 0;
        
        element.textContent = formatTileValue(value);
        element.className = 'highlight ' + getValueClass(value);
    });
}

// Optimized chart update functions
function updateInflationChart(data) {
    if (!chartInstances.inflation || !data.length) return;
    
    const labels = data.map(d => formatDateForChart(d.date));
    const values = data.map(d => d.inflation);
    
    chartInstances.inflation.data.labels = labels;
    chartInstances.inflation.data.datasets[0].data = values;
    chartInstances.inflation.update('none'); // Skip animation for better performance
    
    updateChartStats('inflation', values);
}

function updateHicpChartFixed(data) {
    if (!chartInstances.hicp || !data.length) return;
    
    const labels = data.map(d => formatDateForChart(d.date));
    const values = data.map(d => d.hicp);
    
    chartInstances.hicp.data.labels = labels;
    chartInstances.hicp.data.datasets[0].data = values;
    chartInstances.hicp.update('none'); // Skip animation for better performance
    
    updateChartStats('hicp', values, data);
}

// Rest of the utility functions (optimized)
function filterDataByRange(data, range) {
    if (!data || data.length === 0) return [];
    
    if (range === 'Max') return data;
    
    const now = new Date();
    const startDate = new Date();
    
    const periods = {
        '6kk': () => startDate.setMonth(now.getMonth() - 6),
        '1v': () => startDate.setFullYear(now.getFullYear() - 1),
        '3v': () => startDate.setFullYear(now.getFullYear() - 3),
        '5v': () => startDate.setFullYear(now.getFullYear() - 5)
    };
    
    periods[range]?.();
    
    return data.filter(d => {
        const itemDate = new Date(d.date + '-01');
        return itemDate >= startDate;
    });
}

function formatDateForChart(dateString) {
    const [year, month] = dateString.split('-');
    return `${month}/${year.slice(2)}`;
}

function formatTileValue(value) {
    if (typeof value === 'number') {
        const symbol = value > 0 ? '▲' : value < 0 ? '▼' : '';
        return `${symbol} ${Math.abs(value).toFixed(1)}%`;
    }
    return value.toString();
}

function getValueClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
}

// Loading and error state management
function showLoadingState() {
    document.querySelectorAll('.tile .highlight').forEach(el => {
        if (!el.querySelector('.loading')) {
            el.innerHTML = '<span class="loading"></span>';
            el.className = 'highlight neutral';
        }
    });
}

function hideLoadingState() {
    // Loading states are replaced when data updates
}

function hideChartLoading(chartType) {
    const chart = document.querySelector(`[data-chart="${chartType}"]`);
    if (chart) {
        const loading = chart.querySelector('.chart-loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }
}

function updateChartStats(chartType, values, data = null) {
    if (!values || values.length === 0) return;
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    if (chartType === 'inflation') {
        updateElement('#inflation-min', `Minimi ${min.toFixed(1)}%`);
        updateElement('#inflation-avg', `Keskiarvo ${avg.toFixed(1)}%`);
        updateElement('#inflation-max', `Maksimi ${max.toFixed(1)}%`);
    } else if (chartType === 'hicp' && data && data.length > 0) {
        const latest = data[data.length - 1];
        updateElement('#hicp-trend', `Nousutahti ${latest.inflation > 0 ? '+' : ''}${latest.inflation.toFixed(1)}%`);
        updateElement('#hicp-value', `Indeksiarvo ${latest.hicp.toFixed(2)}`);
        
        const yearAgo = findYearAgoData(data, latest);
        const yearlyChange = yearAgo ? ((latest.hicp - yearAgo.hicp) / yearAgo.hicp) * 100 : 0;
        updateElement('#hicp-change', `Vuosimuutos ${yearlyChange > 0 ? '+' : ''}${yearlyChange.toFixed(1)}%`);
    }
}

function updateElement(selector, text) {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = text;
    }
}

function findYearAgoData(data, latest) {
    const latestDateParts = latest.date.split('-');
    const latestYear = parseInt(latestDateParts[0]);
    const latestMonth = parseInt(latestDateParts[1]);
    
    return data.find(d => {
        const dataDateParts = d.date.split('-');
        const dataYear = parseInt(dataDateParts[0]);
        const dataMonth = parseInt(dataDateParts[1]);
        
        return (latestYear - dataYear === 1) && (latestMonth === dataMonth);
    });
}

function showErrorState(message) {
    console.error('💥 Error state:', message);
    
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
        <button onclick="retryDataFetch()">Yritä uudelleen</button>
    `;
}

function retryDataFetch() {
    const errorElement = document.querySelector('.error-message');
    if (errorElement) errorElement.remove();
    
    // Clear cache and force refresh
    dataCache.clear();
    fetchInflationData(true);
}

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

// Enhanced DOM loaded event with performance monitoring
document.addEventListener('DOMContentLoaded', () => {
    performance.mark('dom-ready');
    console.log('🚀 DOM loaded, initializing application...');
    
    // Carousel functionality with throttling
    const carousel = document.querySelector('.carousel-inner');
    const leftArrow = document.querySelector('.arrow-left');
    const rightArrow = document.querySelector('.arrow-right');

    if (carousel && leftArrow && rightArrow) {
        let isScrolling = false;
        
        const throttledScroll = (direction) => {
            if (isScrolling) return;
            isScrolling = true;
            
            const scrollAmount = direction === 'left' ? -330 : 330;
            carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            
            setTimeout(() => { isScrolling = false; }, 500);
        };
        
        leftArrow.addEventListener('click', () => throttledScroll('left'));
        rightArrow.addEventListener('click', () => throttledScroll('right'));
    }

    // Enhanced chart time range buttons with better UX
    document.querySelectorAll('.chart-controls button').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active state from siblings
            this.parentElement.querySelectorAll('button').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            
            // Add active state to clicked button
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');
            
            // Update current range and refresh charts
            currentChartRange = this.textContent;
            if (inflationData.length > 0) {
                updateCharts();
            }
            
            console.log(`📊 Chart range changed to: ${currentChartRange}`);
        });
    });

    // Initialize first button as active in each chart
    document.querySelectorAll('.chart-controls').forEach(controls => {
        const secondBtn = controls.children[1]; // Default to "1v"
        if (secondBtn) {
            secondBtn.classList.add('active');
            secondBtn.setAttribute('aria-selected', 'true');
            currentChartRange = secondBtn.textContent;
        }
    });

    // Initialize charts when Chart.js is available
    if (typeof Chart !== 'undefined') {
        initializeCharts();
        
        // Initial data fetch
        fetchInflationData();
        
        // Set up auto-refresh with exponential backoff
        let refreshInterval = CONFIG.CACHE_DURATION;
        const setupAutoRefresh = () => {
            setTimeout(async () => {
                try {
                    await fetchInflationData();
                    refreshInterval = CONFIG.CACHE_DURATION; // Reset on success
                } catch (error) {
                    refreshInterval = Math.min(refreshInterval * 2, 30 * 60 * 1000); // Max 30 min
                }
                setupAutoRefresh();
            }, refreshInterval);
        };
        
        setupAutoRefresh();
    } else {
        console.warn('⚠️ Chart.js not loaded yet, charts will initialize when available');
    }
    
    performance.mark('app-ready');
    performance.measure('App Initialization', 'dom-ready', 'app-ready');
    
    console.log('✅ Application initialized successfully');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // Clear intervals and destroy chart instances
    Object.values(chartInstances).forEach(chart => {
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
        }
    });
    
    // Clear caches
    dataCache.clear();
});