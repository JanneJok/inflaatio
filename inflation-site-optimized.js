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

    // Global function to be called when Google Sheets data is loaded
    // This preserves your existing Google Sheets data fetching logic
    window.updateInflationChart = function(labels, data) {
        console.log('Updating inflation chart with Google Sheets data');
        
        if (!inflationChart) {
            console.log('Inflation chart not initialized yet');
            return;
        }
        
        // Store the full data
        fullInflationData = {
            labels: labels,
            datasets: [{
                data: data,
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
        
        // Update chart with full data (Max view by default)
        inflationChart.data = fullInflationData;
        inflationChart.update();
    };
    
    window.updateHicpChart = function(labels, data) {
        console.log('Updating HICP chart with Google Sheets data');
        
        if (!hicpChart) {
            console.log('HICP chart not initialized yet');
            return;
        }
        
        // Store the full data
        fullHicpData = {
            labels: labels,
            datasets: [{
                data: data,
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
        
        // Update chart with full data (Max view by default)
        hicpChart.data = fullHicpData;
        hicpChart.update();
    };
});