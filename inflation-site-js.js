// Configuration
const CONFIG = {
    SHEET_ID: '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8',
    API_KEY: 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g',
    SHEET_RANGE: 'Sheet1!A:Z' // Adjust based on your data structure
};

// Global variables for data storage
let inflationData = [];
let currentChartRange = '1v';

// Fetch data from Google Sheets
async function fetchInflationData() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${CONFIG.SHEET_RANGE}?key=${CONFIG.API_KEY}`;
    
    try {
        showLoadingState();
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.values || data.values.length === 0) {
            throw new Error('No data found in spreadsheet');
        }
        
        inflationData = processSheetData(data.values);
        updateUI();
        hideLoadingState();
        
        return inflationData;
    } catch (error) {
        console.error('Error fetching data:', error);
        showErrorState(error.message);
        return null;
    }
}

// Process raw sheet data into usable format
function processSheetData(rawData) {
    // Assume first row is headers
    const headers = rawData[0];
    const rows = rawData.slice(1);
    
    // Find important column indices (adjust based on your sheet structure)
    const dateCol = findColumnIndex(headers, ['date', 'kuukausi', 'month']);
    const inflationCol = findColumnIndex(headers, ['inflation', 'inflaatio', 'rate']);
    const hicpCol = findColumnIndex(headers, ['hicp', 'indeksi', 'index']);
    
    const processedData = rows.map(row => {
        return {
            date: row[dateCol] || '',
            inflation: parseFloat(row[inflationCol]) || 0,
            hicp: parseFloat(row[hicpCol]) || 0,
            monthlyChange: 0, // Calculate if needed
            rawRow: row
        };
    }).filter(item => item.date && !isNaN(item.inflation));
    
    // Sort by date
    processedData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate monthly changes
    for (let i = 1; i < processedData.length; i++) {
        const current = processedData[i].inflation;
        const previous = processedData[i-1].inflation;
        processedData[i].monthlyChange = current - previous;
    }
    
    return processedData;
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

// Update carousel tiles with real data
function updateCarouselTiles() {
    const latest = inflationData[inflationData.length - 1];
    const previous = inflationData[inflationData.length - 2];
    const yearAgo = inflationData.find(d => {
        const latestDate = new Date(latest.date);
        const dataDate = new Date(d.date);
        return Math.abs(latestDate.getFullYear() - dataDate.getFullYear()) === 1 &&
               latestDate.getMonth() === dataDate.getMonth();
    });
    
    // Calculate statistics
    const currentYear = new Date().getFullYear();
    const thisYearData = inflationData.filter(d => new Date(d.date).getFullYear() === currentYear);
    const last12Months = inflationData.slice(-12);
    
    const yearAverage = thisYearData.length > 0 
        ? (thisYearData.reduce((sum, d) => sum + d.inflation, 0) / thisYearData.length)
        : 0;
    
    const twelveMonthAverage = last12Months.length > 0
        ? (last12Months.reduce((sum, d) => sum + d.inflation, 0) / last12Months.length)
        : 0;
    
    // Update tiles
    const tiles = [
        {
            selector: '.tile:nth-child(1) .highlight',
            value: latest.inflation,
            format: 'percentage'
        },
        {
            selector: '.tile:nth-child(2) .highlight',
            value: previous ? latest.inflation - previous.inflation : 0,
            format: 'percentage'
        },
        {
            selector: '.tile:nth-child(3) .highlight',
            value: twelveMonthAverage,
            format: 'percentage'
        },
        {
            selector: '.tile:nth-child(4) .highlight',
            value: yearAverage,
            format: 'percentage'
        },
        {
            selector: '.tile:nth-child(5) .highlight',
            value: yearAgo ? yearAgo.inflation : 0,
            format: 'percentage'
        }
    ];
    
    tiles.forEach(tile => {
        const element = document.querySelector(tile.selector);
        if (element) {
            const formattedValue = formatValue(tile.value, tile.format);
            element.textContent = formattedValue;
            element.className = `highlight ${getValueClass(tile.value)}`;
        }
    });
}

// Format values for display
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
    
    return data.filter(d => new Date(d.date) >= startDate);
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
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    if (chartType === 'inflation') {
        const statsElements = document.querySelectorAll('#inflationChart').closest('.chart').querySelectorAll('.chart-stats p');
        if (statsElements[0]) statsElements[0].innerHTML = `<span class="percentage-badge">🔵</span> Minimi ${min.toFixed(1)}%`;
        if (statsElements[1]) statsElements[1].innerHTML = `<span class="percentage-badge">🟡</span> Keskiarvo ${avg.toFixed(1)}%`;
        if (statsElements[2]) statsElements[2].innerHTML = `<span class="percentage-badge">🔴</span> Maksimi ${max.toFixed(1)}%`;
    } else if (chartType === 'hicp' && data) {
        const latest = data[data.length - 1];
        const yearAgo = data.find(d => {
            const latestDate = new Date(latest.date);
            const dataDate = new Date(d.date);
            return Math.abs(latestDate.getTime() - dataDate.getTime()) < 366 * 24 * 60 * 60 * 1000;
        });
        
        const yearlyChange = yearAgo ? ((latest.hicp - yearAgo.hicp) / yearAgo.hicp) * 100 : 0;
        
        const statsElements = document.querySelectorAll('#hicpChart').closest('.chart').querySelectorAll('.chart-stats p');
        if (statsElements[0]) statsElements[0].innerHTML = `<span class="percentage-badge">📈</span> Nousutahti +${latest.inflation.toFixed(1)}%`;
        if (statsElements[1]) statsElements[1].innerHTML = `<span class="percentage-badge">📊</span> Indeksiarvo ${latest.hicp.toFixed(2)}`;
        if (statsElements[2]) statsElements[2].innerHTML = `<span class="percentage-badge">📅</span> Vuosimuutos +${yearlyChange.toFixed(1)}%`;
    }
}

// Format date for chart display
function formatDateForChart(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('fi-FI', { 
        year: '2-digit', 
        month: '2-digit' 
    });
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