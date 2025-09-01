document.addEventListener('DOMContentLoaded', () => {
    // Carousel functionality
    const carousel = document.querySelector('.carousel-inner');
    const leftArrow = document.querySelector('.arrow-left');
    const rightArrow = document.querySelector('.arrow-right');

    if (carousel && leftArrow && rightArrow) {
        leftArrow.addEventListener('click', () => {
            carousel.scrollBy({ left: -330, behavior: 'smooth' }); // Adjusted to tile width (300px) + gap (1.5rem ≈ 24px)
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

    // Initialize first button as active in each chart
    document.querySelectorAll('.chart-controls').forEach(controls => {
        const firstBtn = controls.querySelector('button');
        if (firstBtn) {
            firstBtn.classList.add('active');
        }
    });

    // Initialize Chart.js charts if available
    if (typeof Chart !== 'undefined') {
        initializeCharts();
    }
});

function initializeCharts() {
    // Full historical data for both charts
    const fullInflationData = {
        labels: [
            '2020-01', '2020-04', '2020-07', '2020-10', 
            '2021-01', '2021-04', '2021-07', '2021-10', 
            '2022-01', '2022-04', '2022-07', '2022-10', 
            '2023-01', '2023-04', '2023-07', '2023-10', 
            '2024-01', '2024-04', '2024-07', '2024-10', 
            '2025-01'
        ],
        data: [
            1.1, 0.5, 0.4, 0.8, 
            1.4, 1.9, 2.1, 2.6, 
            5.2, 7.1, 8.4, 9.1, 
            8.5, 6.3, 5.0, 3.5, 
            2.5, 2.0, 1.8, 1.9, 
            1.9
        ]
    };

    const fullHICPData = {
        labels: [
            '2020-01', '2020-04', '2020-07', '2020-10', 
            '2021-01', '2021-04', '2021-07', '2021-10', 
            '2022-01', '2022-04', '2022-07', '2022-10', 
            '2023-01', '2023-04', '2023-07', '2023-10', 
            '2024-01', '2024-04', '2024-07', '2024-10', 
            '2025-01'
        ],
        data: [
            104.5, 104.2, 104.0, 104.3, 
            105.1, 105.6, 106.2, 106.8, 
            110.2, 112.5, 114.7, 116.3, 
            115.0, 116.0, 117.0, 118.0, 
            118.5, 119.0, 119.3, 119.6, 
            119.9
        ]
    };

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

    // Global chart instances to update
    let inflationChart, hicpChart;

    // Function to get chart data for different time ranges
    function getChartDataRange(data, timeRange) {
        const getRangeStartIndex = (range) => {
            switch(range) {
                case '6kk': return data.labels.length - 6;
                case '1v': return data.labels.length - 12;
                case '3v': return data.labels.length - 36;
                case '5v': return data.labels.length - 60;
                default: return 0; // Max/full range
            }
        };

        const startIndex = getRangeStartIndex(timeRange);
        return {
            labels: data.labels.slice(startIndex),
            data: data.data.slice(startIndex)
        };
    }

    // Initialize Inflation Chart
    const inflationCanvas = document.getElementById('inflationChart');
    if (inflationCanvas) {
        const inflationCtx = inflationCanvas.getContext('2d');
        inflationChart = new Chart(inflationCtx, {
            type: 'line',
            data: {
                labels: fullInflationData.labels,
                datasets: [{
                    data: fullInflationData.data,
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

        hicpChart = new Chart(hicpCtx, {
            type: 'line',
            data: {
                labels: fullHICPData.labels,
                datasets: [{
                    data: fullHICPData.data,
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
    }

    // Add click event listeners to chart controls
    document.querySelectorAll('.chart-controls').forEach(controlsContainer => {
        const buttons = controlsContainer.querySelectorAll('button');
        const chartId = controlsContainer.closest('.chart').querySelector('canvas').id;

        buttons.forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active class from siblings
                buttons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Get selected range
                const selectedRange = this.textContent;
                console.log(`📊 ${chartId} chart range changed to: ${selectedRange}`);

                // Determine which chart to update
                let chart, data;
                if (chartId === 'inflationChart') {
                    chart = inflationChart;
                    data = fullInflationData;
                } else if (chartId === 'hicpChart') {
                    chart = hicpChart;
                    data = fullHICPData;
                }

                if (chart && data) {
                    // Get filtered data
                    const filteredData = getChartDataRange(data, selectedRange);

                    // Update chart data
                    chart.data.labels = filteredData.labels;
                    chart.data.datasets[0].data = filteredData.data;
                    chart.update();
                }
            });
        });
    });
}