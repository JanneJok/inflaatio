document.addEventListener('DOMContentLoaded', () => {
    // Store chart instances and data globally
    let inflationChart = null;
    let hicpChart = null;
    let inflationData = null;
    let hicpData = null;
    
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
        if (!data || !data.labels || !data.datasets) return null;
        
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
            console.log('Chart or data not available');
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
                
                if (inflationChart && inflationData) {
                    updateChart(inflationChart, inflationData, range);
                } else {
                    console.log('Inflation chart or data not yet initialized');
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
                
                if (hicpChart && hicpData) {
                    updateChart(hicpChart, hicpData, range);
                } else {
                    console.log('HICP chart or data not yet initialized');
                }
            });
        });
    }

    // Initialize first button as active in each chart
    document.querySelectorAll('.chart-controls').forEach(controls => {
        const maxBtn = Array.from(controls.querySelectorAll('button')).find(btn => btn.textContent === 'Max');
        if (maxBtn) {
            maxBtn.classList.add('active');
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

        // Initialize Inflation Chart with sample data
        const inflationCanvas = document.getElementById('inflationChart');
        if (inflationCanvas) {
            const inflationCtx = inflationCanvas.getContext('2d');
            
            // Store full data
            inflationData = {
                labels: ['2020-01', '2020-04', '2020-07', '2020-10', 
                        '2021-01', '2021-04', '2021-07', '2021-10',
                        '2022-01', '2022-04', '2022-07', '2022-10',
                        '2023-01', '2023-04', '2023-07', '2023-10', 
                        '2024-01', '2024-04', '2024-07', '2024-10', 
                        '2025-01'],
                datasets: [{
                    data: [1.0, 0.5, 0.2, 0.3,
                          0.9, 1.5, 2.2, 3.1,
                          4.5, 6.2, 7.9, 8.8,
                          8.5, 6.3, 5.0, 3.5, 
                          2.5, 2.0, 1.8, 1.9, 
                          1.9],
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
            
            inflationChart = new Chart(inflationCtx, {
                type: 'line',
                data: inflationData,
                options: chartConfig
            });
        }

        // Initialize HICP Chart with sample data
        const hicpCanvas = document.getElementById('hicpChart');
        if (hicpCanvas) {
            const hicpCtx = hicpCanvas.getContext('2d');
            
            // Store full data
            hicpData = {
                labels: ['2020-01', '2020-04', '2020-07', '2020-10', 
                        '2021-01', '2021-04', '2021-07', '2021-10',
                        '2022-01', '2022-04', '2022-07', '2022-10',
                        '2023-01', '2023-04', '2023-07', '2023-10', 
                        '2024-01', '2024-04', '2024-07', '2024-10', 
                        '2025-01'],
                datasets: [{
                    data: [103, 103.2, 103.1, 103.3,
                          104, 104.8, 106, 107.5,
                          108, 110, 112, 114,
                          115, 116, 117, 118, 
                          118.5, 119, 119.3, 119.6, 
                          119.9],
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
            
            hicpChart = new Chart(hicpCtx, {
                type: 'line',
                data: hicpData,
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

    // Function to update charts with Google Sheets data
    // This will be called when Google Sheets data is loaded
    window.updateChartsWithGoogleData = function(inflationDataFromSheets, hicpDataFromSheets) {
        console.log('Updating charts with Google Sheets data');
        
        if (inflationDataFromSheets && inflationChart) {
            inflationData = inflationDataFromSheets;
            inflationChart.data = inflationData;
            inflationChart.update();
        }
        
        if (hicpDataFromSheets && hicpChart) {
            hicpData = hicpDataFromSheets;
            hicpChart.data = hicpData;
            hicpChart.update();
        }
    };
});