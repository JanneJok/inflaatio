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

// Rest of the existing code remains the same... (the complete file from the previous document)

// Modify the setupChartControls function specifically
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
                
                // Get the selected range from button text
                const selectedRange = this.textContent;
                
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
                        updateHicpChart(filteredData);
                    }
                }
            });
        });
    });
}
