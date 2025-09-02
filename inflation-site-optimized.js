// Configuration for proxy server (MUUTETTU OSIO - korvaa CONFIG)
const CONFIG = {
    PROXY_BASE_URL: 'https://script.google.com/macros/s/AKfycbznAkSnDUS-VG0lwLhywjpZhJGE_z-z4SohajkhlP45YYudBODbUOtzKOAH-w9hlejW/exec', // Päivitä oikea URL deployment jälkeen
    HISTORICAL_RANGE: 'Raakadata!A:F',
    METRICS_RANGE: 'Key Metrics!A:B',
    CACHE_DURATION: 5 * 60 * 1000
};

// Global variables
let inflationData = [];
let keyMetrics = {};
let dataCache = new Map();
let lastFetch = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Store chart instances globally for updates
    let inflationChart = null;
    let hicpChart = null;
    let fullInflationData = null;
    let fullHicpData = null;
    
    // Carousel functionality
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

    // Function to filter data based on time range
    function filterDataByRange(data, range) {
        if (!data || !data.labels || !data.datasets) {
            console.log('No data available to filter');
            return null;
        }
        
        const totalPoints = data.labels.length;
        let pointsToShow;
        
        switch(range) {
            case '6kk':
                pointsToShow = Math.min(6, totalPoints);
                break;
            case '1v':
                pointsToShow = Math.min(12, totalPoints);
                break;
            case '3v':
                pointsToShow = Math.min(36, totalPoints);
                break;
            case '5v':
                pointsToShow = Math.min(60, totalPoints);
                break;
            case 'Max':
            default:
                pointsToShow = totalPoints;
                break;
        }
        
        const startIndex = Math.max(0, totalPoints - pointsToShow);
        
        return {
            labels: data.labels.slice(startIndex),
            datasets: data.datasets.map(dataset => ({
                ...dataset,
                data: dataset.data.slice(startIndex)
            }))
        };
    }

    // Function to update chart with filtered data
    function updateChart(chart, fullData, range) {
        if (!chart || !fullData) {
            console.log('Chart or data not available for update');
            return;
        }
        
        const filteredData = filterDataByRange(fullData, range);
        if (filteredData) {
            chart.data = filteredData;
            chart.update('none'); // Use 'none' for instant update without animation
        }
    }

    // Chart time range buttons - Inflation Chart
    const inflationControls = document.querySelector('#analytiikka .chart:first-child .chart-controls');
    if (inflationControls) {
        inflationControls.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active class from siblings
                this.parentElement.querySelectorAll('button').forEach(b => {
                    b.classList.remove('active');
                });
                // Add active class to clicked button
                this.classList.add('active');
                
                // Update inflation chart
                const range = this.textContent;
                console.log('📊 Inflation chart range changed to:', range);
                
                if (inflationChart && fullInflationData) {
                    updateChart(inflationChart, fullInflationData, range);
                } else {
                    console.log('Waiting for inflation data from Google Sheets...');
                }
            });
        });
    }

    // Chart time range buttons - HICP Chart
    const hicpControls = document.querySelector('#analytiikka .chart:last-child .chart-controls');
    if (hicpControls) {
        hicpControls.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active class from siblings
                this.parentElement.querySelectorAll('button').forEach(b => {
                    b.classList.remove('active');
                });
                // Add active class to clicked button
                this.classList.add('active');
                
                // Update HICP chart
                const range = this.textContent;
                console.log('📈 HICP chart range changed to:', range);
                
                if (hicpChart && fullHicpData) {
                    updateChart(hicpChart, fullHicpData, range);
                } else {
                    console.log('Waiting for HICP data from Google Sheets...');
                }
            });
        });
    }

    // Initialize first button as active in each chart
    document.querySelectorAll('.chart-controls').forEach(controls => {
        const defaultBtn = Array.from(controls.querySelectorAll('button')).find(btn => btn.textContent === '5v');
        if (defaultBtn) {
            defaultBtn.classList.add('active');
        }
    });

    // Initialize Chart.js charts if available
    if (typeof Chart !== 'undefined') {
        initializeCharts();
    }

    function initializeCharts() {
        const chartConfig = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
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
                        },
                        autoSkip: true,
                        maxTicksLimit: window.innerWidth < 768 ? 6 : 12
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

        // Initialize empty Inflation Chart - will be populated with Google Sheets data
        const inflationCanvas = document.getElementById('inflationChart');
        if (inflationCanvas) {
            const inflationCtx = inflationCanvas.getContext('2d');
            
            inflationChart = new Chart(inflationCtx, {
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

        // Initialize empty HICP Chart - will be populated with Google Sheets data
        const hicpCanvas = document.getElementById('hicpChart');
        if (hicpCanvas) {
            const hicpCtx = hicpCanvas.getContext('2d');
            
            hicpChart = new Chart(hicpCtx, {
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

    // PROXY FETCH FUNKTIOT (KORVATTU OSIO)
    // Secure fetch through proxy server
    async function fetchThroughProxy(range) {
    try {
        // HUOM: Ei /api/sheets polkua!
        const url = `${CONFIG.PROXY_BASE_URL}?range=${encodeURIComponent(range)}`;
        console.log(`🔄 Fetching through proxy: ${range}`);
        
        const response = await fetch(url, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Proxy error ${response.status}: ${errorData.error || 'Unknown error'}`);
        }

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Proxy returned unsuccessful response');
        }

        return result.data;

    } catch (error) {
        console.error(`Error fetching range ${range}:`, error);
        throw error;
    }
}

    // Fetch and process Google Sheets data (PÄIVITETTY FUNKTIO)
    async function fetchInflationData() {
        const cacheKey = 'inflation_data';
        const now = Date.now();
        
        // Check cache
        if (dataCache.has(cacheKey) && (now - lastFetch) < CONFIG.CACHE_DURATION) {
            const cachedData = dataCache.get(cacheKey);
            inflationData = cachedData.historical || [];
            keyMetrics = cachedData.metrics || {};
            updateChartsWithData();
            return cachedData;
        }

        try {
            console.log('🔄 Fetching data through secure proxy...');
            
            // Fetch through proxy server instead of direct API calls
            const [historicalData, metricsData] = await Promise.all([
                fetchThroughProxy(CONFIG.HISTORICAL_RANGE),
                fetchThroughProxy(CONFIG.METRICS_RANGE)
            ]);

            // Process historical data
            if (historicalData?.length > 1) {
                inflationData = processHistoricalData(historicalData);
            }

            // Process metrics data
            if (metricsData?.length > 1) {
                keyMetrics = processKeyMetrics(metricsData);
                updateTiles();
            }

            // Cache results
            const processedData = { historical: inflationData, metrics: keyMetrics };
            dataCache.set(cacheKey, processedData);
            lastFetch = now;

            // Update charts with fetched data
            updateChartsWithData();
            
            console.log('✅ Data loaded successfully through proxy');
            return processedData;

        } catch (error) {
            console.error('❌ Data fetch error:', error);
            showErrorMessage('Tietojen lataaminen epäonnistui. Tarkista verkkoyhteytesi.');
            return null;
        }
    }

    // Show error message to user (UUSI FUNKTIO)
    function showErrorMessage(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(239, 68, 68, 0.9);
            color: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            z-index: 1001;
            backdrop-filter: blur(10px);
        `;
        
        document.body.appendChild(errorDiv);
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    // Process historical data from Google Sheets (EI MUUTOKSIA)
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

    // Process key metrics (EI MUUTOKSIA)
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

    // Update tiles with metrics (EI MUUTOKSIA)
    function updateTiles() {
        if (!keyMetrics || Object.keys(keyMetrics).length === 0) return;
        
        const tiles = document.querySelectorAll('.tile .highlight');
        const metricKeys = Object.keys(keyMetrics);
        
        tiles.forEach((tile, index) => {
            if (index < metricKeys.length) {
                const value = keyMetrics[metricKeys[index]];
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
                    }
                }
            }
        });
    }

    // Update charts with fetched data (EI MUUTOKSIA)
    function updateChartsWithData() {
        if (!inflationData || inflationData.length === 0) {
            console.log('No data to update charts');
            return;
        }

        console.log('📊 Updating charts with', inflationData.length, 'data points');

        // Prepare data for charts
        const labels = inflationData.map(d => d.date.substr(2)); // YY-MM format
        const inflationValues = inflationData.map(d => d.inflation);
        const hicpValues = inflationData.map(d => d.hicp);

        // Update inflation chart
        if (inflationChart) {
            fullInflationData = {
                labels: labels,
                datasets: [{
                    data: inflationValues,
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
            };

            // Apply current filter (default 5v)
            const activeBtn = document.querySelector('#analytiikka .chart:first-child .chart-controls button.active');
            const range = activeBtn ? activeBtn.textContent : '5v';
            updateChart(inflationChart, fullInflationData, range);
        }

        // Update HICP chart
        if (hicpChart) {
            fullHicpData = {
                labels: labels,
                datasets: [{
                    data: hicpValues,
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
            };

            // Apply current filter (default 5v)
            const activeBtn = document.querySelector('#analytiikka .chart:last-child .chart-controls button.active');
            const range = activeBtn ? activeBtn.textContent : '5v';
            updateChart(hicpChart, fullHicpData, range);
        }
    }

    // Fetch data on load
    fetchInflationData();
    
    // Set up auto-refresh every 5 minutes
    setInterval(fetchInflationData, CONFIG.CACHE_DURATION);
});