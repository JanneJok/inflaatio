document.addEventListener('DOMContentLoaded', () => {
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

    // Initialize Chart.js charts if available
    if (typeof Chart !== 'undefined') {
        initializeCharts();
    }
});

async function initializeCharts() {
    // Fetch full historical data from Google Sheets
    try {
        // Replace with your actual Google Sheets URL
        const response = await fetch('https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv');
        const csvData = await response.text();
        
        // Parse CSV data
        const { fullInflationData, fullHICPData } = parseHistoricalData(csvData);

        setupCharts(fullInflationData, fullHICPData);
    } catch (error) {
        console.error('Error fetching historical data:', error);
        
        // Fallback to hardcoded data if fetch fails
        const fullInflationData = {
            labels: [
                '1997-01', '1997-07', '1998-01', '1998-07', 
                '1999-01', '1999-07', '2000-01', '2000-07',
                // ... continue with full historical data
                '2024-01', '2024-07', '2025-01'
            ],
            data: [
                1.4, 1.2, 1.5, 1.3, 
                1.6, 1.4, 1.7, 1.5,
                // ... continue with full historical inflation data
                2.0, 1.8, 1.9
            ]
        };

        const fullHICPData = {
            labels: [
                '1997-01', '1997-07', '1998-01', '1998-07', 
                '1999-01', '1999-07', '2000-01', '2000-07',
                // ... continue with full historical data
                '2024-01', '2024-07', '2025-01'
            ],
            data: [
                100.5, 101.0, 101.5, 102.0, 
                102.5, 103.0, 103.5, 104.0,
                // ... continue with full historical HICP data
                119.0, 119.6, 119.9
            ]
        };

        setupCharts(fullInflationData, fullHICPData);
    }
}

function parseHistoricalData(csvData) {
    // Implement CSV parsing logic
    // This is a placeholder - you'll need to adjust based on your actual CSV structure
    const rows = csvData.split('\n').map(row => row.split(','));
    
    const fullInflationData = {
        labels: [],
        data: []
    };

    const fullHICPData = {
        labels: [],
        data: []
    };

    // Assuming CSV has columns: Date, Inflation, HICP
    rows.forEach((row, index) => {
        if (index > 0) { // Skip header
            fullInflationData.labels.push(row[0]);
            fullInflationData.data.push(parseFloat(row[1]));
            
            fullHICPData.labels.push(row[0]);
            fullHICPData.data.push(parseFloat(row[2]));
        }
    });

    return { fullInflationData, fullHICPData };
}

function setupCharts(fullInflationData, fullHICPData) {
    const chartConfig = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
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

    // Function to get chart data for different time ranges
    function getChartDataRange(data, timeRange) {
        const yearsToShow = {
            '6kk': 0.5,
            '1v': 1,
            '3v': 3,
            '5v': 5,
            'Max': Infinity
        };

        const currentDate = new Date('2025-01-01');
        const years = yearsToShow[timeRange];
        
        // Filter data based on time range
        const filteredData = {
            labels: [],
            data: []
        };

        for (let i = 0; i < data.labels.length; i++) {
            const dataDate = new Date(data.labels[i]);
            const diffYears = (currentDate - dataDate) / (1000 * 60 * 60 * 24 * 365.25);
            
            if (diffYears <= years) {
                filteredData.labels.push(data.labels[i]);
                filteredData.data.push(data.data[i]);
            }
        }

        return filteredData;
    }

    // Initialize Inflation Chart
    const inflationCanvas = document.getElementById('inflationChart');
    if (inflationCanvas) {
        const inflationCtx = inflationCanvas.getContext('2d');
        
        // Default to 5 years of data
        const inflationRangeData = getChartDataRange(fullInflationData, '5v');
        
        const inflationChart = new Chart(inflationCtx, {
            type: 'line',
            data: {
                labels: inflationRangeData.labels,
                datasets: [{
                    data: inflationRangeData.data,
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

        // Chart controls for Inflation
        const inflationControls = document.querySelectorAll('#inflationChart + .chart-controls button');
        inflationControls.forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active class from siblings
                inflationControls.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                const selectedRange = this.textContent;
                const rangeData = getChartDataRange(fullInflationData, selectedRange);

                inflationChart.data.labels = rangeData.labels;
                inflationChart.data.datasets[0].data = rangeData.data;
                inflationChart.update();
            });
        });

        // Set '5v' as default active
        inflationControls[3].classList.add('active');
    }

    // Initialize HICP Chart
    const hicpCanvas = document.getElementById('hicpChart');
    if (hicpCanvas) {
        const hicpCtx = hicpCanvas.getContext('2d');
        
        // Modify chart config for HICP (different y-axis)
        const hicpChartConfig = {
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
        };

        // Default to 5 years of data
        const hicpRangeData = getChartDataRange(fullHICPData, '5v');
        
        const hicpChart = new Chart(hicpCtx, {
            type: 'line',
            data: {
                labels: hicpRangeData.labels,
                datasets: [{
                    data: hicpRangeData.data,
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
            options: hicpChartConfig
        });

        // Chart controls for HICP
        const hicpControls = document.querySelectorAll('#hicpChart + .chart-controls button');
        hicpControls.forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active class from siblings
                hicpControls.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                const selectedRange = this.textContent;
                const rangeData = getChartDataRange(fullHICPData, selectedRange);

                hicpChart.data.labels = rangeData.labels;
                hicpChart.data.datasets[0].data = rangeData.data;
                hicpChart.update();
            });
        });

        // Set '5v' as default active
        hicpControls[3].classList.add('active');
    }
}