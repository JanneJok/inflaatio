// Configuration for proxy server
const CONFIG = {
    SHEET_ID: '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8',
    API_KEY: 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g',
    HISTORICAL_RANGE: 'Raakadata!A:F',
    METRICS_RANGE: 'Key Metrics!A:B',
    CACHE_DURATION: 5 * 60 * 1000
};

// EmailJS configuration
const EMAILJS_CONFIG = {
    SERVICE_ID: 'service_nnxux1e',
    TEMPLATE_ID: 'template_evci98f',
    PUBLIC_KEY: 'EV6UX6GIPG231yXUd'
};

// Supabase configuration for analytics
const SUPABASE_CONFIG = {
    URL: 'https://ysuhexvvgjoizrcdrxso.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzdWhleHZ2Z2pvaXpyY2RyeHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2MDQzODksImV4cCI6MjA3ODE4MDM4OX0.0UFYz-xd_QmUEdVcKWqRo6D4QcwvAmlKDKSdu7M4ENA'
};

// Initialize Supabase client (lightweight inline version)
const supabase = (() => {
    const headers = {
        'apikey': SUPABASE_CONFIG.ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        'Content-Type': 'application/json'
    };

    return {
        from: (table) => ({
            insert: async (data) => {
                try {
                    const response = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${table}`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(data)
                    });
                    return { error: response.ok ? null : await response.json() };
                } catch (error) {
                    return { error };
                }
            },
            select: async (columns = '*') => {
                try {
                    const response = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${table}?select=${columns}`, {
                        method: 'GET',
                        headers: headers
                    });
                    const data = await response.json();
                    return { data: response.ok ? data : null, error: response.ok ? null : data };
                } catch (error) {
                    return { data: null, error };
                }
            }
        })
    };
})();

// Anonymous analytics tracking (GDPR compliant - no personal data)
const Analytics = window.Analytics = {
    pageLoadTime: Date.now(),

    async track(eventType, metadata = {}) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const page = window.location.pathname;
            const referrer = document.referrer ? new URL(document.referrer).hostname : 'direct';

            // Extract search query from URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const searchQuery = urlParams.get('q') || urlParams.get('search') ||
                               urlParams.get('query') || urlParams.get('s') ||
                               urlParams.get('utm_term') || null;

            const payload = {
                date: today,
                event_type: eventType,
                page: page,
                referrer: referrer,
                search_query: searchQuery,
                count: 1
            };

            // Add session duration for session_end events
            if (eventType === 'session_end' && metadata.duration) {
                payload.session_duration = Math.round(metadata.duration);
            }

            const { error } = await supabase.from('inflaatio_analytics').insert(payload);

            if (error) console.error('Analytics error:', error);
        } catch (error) {
            // Fail silently - analytics should never break the site
            console.debug('Analytics tracking failed:', error);
        }
    },

    pageView() {
        this.track('page_view');
        this.startSessionTracking();
    },

    startSessionTracking() {
        // Track session duration
        this.pageLoadTime = Date.now();
        let lastTrackedDuration = 0;

        // Send session duration - works for both periodic and final tracking
        const trackSessionEnd = (isFinal = false) => {
            const duration = (Date.now() - this.pageLoadTime) / 1000; // seconds
            console.log('Session duration:', duration + 's', isFinal ? '(final)' : '(periodic)');

            // Only track if stayed more than 3 seconds AND duration has increased by at least 2 seconds
            if (duration > 3 && (duration - lastTrackedDuration) >= 2) {
                lastTrackedDuration = duration;

                const today = new Date().toISOString().split('T')[0];
                const page = window.location.pathname;
                const referrer = document.referrer ? new URL(document.referrer).hostname : 'direct';

                const payload = {
                    date: today,
                    event_type: 'session_end',
                    page: page,
                    referrer: referrer,
                    search_query: null,
                    count: 1,
                    session_duration: Math.round(duration)
                };

                const url = `${SUPABASE_CONFIG.URL}/rest/v1/inflaatio_analytics`;

                // Use fetch with keepalive for final tracking (more reliable on page unload)
                if (isFinal) {
                    fetch(url, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_CONFIG.ANON_KEY,
                            'Authorization': `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify(payload),
                        keepalive: true
                    }).then(() => {
                        console.log('✓ Final session tracked:', Math.round(duration) + 's');
                    }).catch(err => {
                        console.error('✗ Final session track failed:', err);
                    });
                } else {
                    // For periodic tracking, use regular async insert
                    supabase.from('inflaatio_analytics').insert(payload).then(({ error }) => {
                        if (error) {
                            console.error('✗ Periodic session track failed:', error);
                        } else {
                            console.log('✓ Periodic session tracked:', Math.round(duration) + 's');
                        }
                    });
                }
            }
        };

        // Track every 5 seconds while user is active
        const intervalId = setInterval(() => {
            if (!document.hidden) {
                trackSessionEnd(false);
            }
        }, 5000);

        // Track on page unload
        window.addEventListener('beforeunload', () => {
            clearInterval(intervalId);
            trackSessionEnd(true);
        });

        window.addEventListener('pagehide', () => {
            clearInterval(intervalId);
            trackSessionEnd(true);
        });

        // Track on visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                trackSessionEnd(true);
            }
        });
    },

    chartInteraction(chartType) {
        this.track('chart_interaction', { chart: chartType });
    },

    contactForm() {
        this.track('contact_form');
    },

    cookieAccept() {
        this.track('cookie_accept');
    },

    cookieDecline() {
        this.track('cookie_decline');
    }
};

// Global variables
let inflationData = [];
let keyMetrics = {};
let dataCache = new Map();
let lastFetch = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Track page view (anonymous, GDPR compliant)
    Analytics.pageView();

    // Initialize EmailJS when available (lazy loaded)
    function initEmailJS() {
        if (typeof emailjs !== 'undefined' && !window.emailJsInitialized) {
            emailjs.init(EMAILJS_CONFIG.PUBLIC_KEY);
            window.emailJsInitialized = true;
        }
    }

    // Try to initialize EmailJS if already loaded, otherwise wait for lazy load
    initEmailJS();

    // Check periodically if EmailJS becomes available
    const emailJsInterval = setInterval(() => {
        if (typeof emailjs !== 'undefined') {
            initEmailJS();
            clearInterval(emailJsInterval);
        }
    }, 100);
    
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

    // Modal functionality
    const contactModal = document.getElementById('contactModal');
    const contactModalBtn = document.getElementById('contactModalBtn');
    const modalClose = document.getElementById('modalClose');
    const modalOverlay = document.getElementById('modalOverlay');
    const contactForm = document.getElementById('contactForm');

    // Open modal
    if (contactModalBtn) {
        contactModalBtn.addEventListener('click', function(e) {
            e.preventDefault();
            openModal();
        });
    }

    // Close modal
    if (modalClose) {
        modalClose.addEventListener('click', closeModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeModal);
    }

    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && contactModal && contactModal.classList.contains('show')) {
            closeModal();
        }
    });

    function openModal() {
        if (contactModal) {
            contactModal.style.display = 'flex';
            setTimeout(() => {
                contactModal.classList.add('show');
            }, 10);
            document.body.style.overflow = 'hidden';
        }
    }

    function closeModal() {
        if (contactModal) {
            contactModal.classList.remove('show');
            setTimeout(() => {
                contactModal.style.display = 'none';
                document.body.style.overflow = '';
                // Reset form if needed
                resetContactForm();
            }, 300);
        }
    }

    function resetContactForm() {
        const form = document.getElementById('contactForm');
        const successDiv = document.getElementById('contactSuccess');
        
        if (form && successDiv) {
            form.style.display = 'block';
            form.reset();
            successDiv.style.display = 'none';
            
            // Reset button state
            const submitBtn = form.querySelector('.submit-btn');
            const btnText = submitBtn ? submitBtn.querySelector('.btn-text') : null;
            const btnLoading = submitBtn ? submitBtn.querySelector('.btn-loading') : null;
            
            if (submitBtn) {
                submitBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoading) btnLoading.style.display = 'none';
            }
        }
    }

    // Contact form submission handler
    if (contactForm) {
        contactForm.addEventListener('submit', handleContactSubmit);
    }

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

                // Track chart interaction
                Analytics.chartInteraction('inflation_' + range);

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

                // Track chart interaction
                Analytics.chartInteraction('hicp_' + range);

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

    // Make initCharts available globally for lazy loading
    window.initCharts = function() {
        if (window.chartsInitialized) {
            console.log('⚠️ Charts already initialized, skipping...');
            return; // Prevent double initialization
        }

        // Check if Chart.js is loaded
        if (typeof Chart === 'undefined') {
            console.error('❌ Chart.js not loaded yet when initCharts called');
            return;
        }

        console.log('📊 Initializing Chart.js charts...');
        window.chartsInitialized = true; // Set AFTER check, BEFORE init
        initializeCharts();
    };

    // Initialize Chart.js charts if available immediately
    if (typeof Chart !== 'undefined') {
        console.log('⚡ Chart.js available on page load, initializing immediately');
        window.initCharts();
    } else {
        console.log('⏳ Chart.js not loaded yet, waiting for lazy load...');
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

        // If data was already loaded before Chart.js, update charts now
        console.log('✅ Charts initialized. Data available:', inflationData.length > 0);
        if (inflationData.length > 0) {
            console.log('📊 Data was loaded before charts - updating now...');
            updateChartsWithData();
        }
    }

    // JSONP fetchThroughProxy-funktio
    async function fetchThroughProxy(range) {
        try {
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?key=${CONFIG.API_KEY}`;
            console.log(`📄 Fetching directly from Google Sheets: ${range}`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Google Sheets API error: ${response.status}`);
            }

            const result = await response.json();
            return result.values || [];

        } catch (error) {
            console.error(`Error fetching range ${range}:`, error);
            throw error;
        }
    }

    // Fetch and process Google Sheets data
    async function fetchInflationData() {
        // CHECK FOR STATIC DATA FIRST (no API calls needed!)
        if (window.STATIC_DATA_AVAILABLE && typeof STATIC_INFLATION_DATA !== 'undefined') {
            console.log('✅ Using static inline data (no API calls)');

            inflationData = STATIC_INFLATION_DATA.map(row => ({
                date: row[0],
                inflation: row[1],
                hicp: row[2] || 0  // HICP index from column 3
            }));

            console.log(`📊 Loaded ${inflationData.length} data points from static data (with HICP)`);

            // Update year table note with current year data
            updateYearTableNote(inflationData);

            updateChartsWithData();

            // Static data cards are already in HTML, no need to update
            return { historical: inflationData, metrics: {} };
        }

        // FALLBACK: If no static data, use API (old behavior)
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
            console.log('📄 Fetching data through secure proxy (fallback mode)...');
            
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

    // Show error message to user
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

    // Process historical data from Google Sheets
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

        const sorted = processedData.sort((a, b) => new Date(a.date + '-01') - new Date(b.date + '-01'));

        // Update year table note with current year data
        updateYearTableNote(sorted);

        return sorted;
    }

    // Update the year table note to show current year and month count
    function updateYearTableNote(data) {
        const noteElement = document.getElementById('yearTableNote');
        if (!noteElement || !data || data.length === 0) return;

        const currentYear = new Date().getFullYear();
        const currentYearData = data.filter(item => {
            const itemYear = parseInt(item.date.split('-')[0]);
            return itemYear === currentYear;
        });

        if (currentYearData.length > 0) {
            const baseText = 'Lähde: Eurostat HICP (Harmonised Index of Consumer Prices). Luvut edustavat vuosikeskiarvoja.';
            const monthCount = currentYearData.length;
            noteElement.textContent = `${baseText} ${currentYear} data perustuu ${monthCount} kuukauteen.`;
        }
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

    // Update tiles with metrics
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

    // Update charts with fetched data
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

    // Only set up auto-refresh if using API (not needed for static data)
    if (!window.STATIC_DATA_AVAILABLE) {
        setInterval(fetchInflationData, CONFIG.CACHE_DURATION);
        console.log('⏰ Auto-refresh enabled (API mode)');
    } else {
        console.log('⏰ Auto-refresh disabled (using static data)');
    }
    
    // Header scroll-animaatio
    window.addEventListener('scroll', () => {
        const navbar = document.querySelector('.navbar');
        const scrolled = window.scrollY > 50;
        
        if (scrolled) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
});

// Contact form submission handler
async function handleContactSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitBtn = form.querySelector('.submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    const successDiv = document.getElementById('contactSuccess');
    
    // Get form data
    const formData = new FormData(form);
    const userName = formData.get('userName').trim();
    const userEmail = formData.get('userEmail').trim();
    const userMessage = formData.get('userMessage').trim();
    
    // Validate
    if (!userName || !userEmail || !userMessage) {
        alert('Täytä kaikki vaaditut kentät.');
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        // Send email via EmailJS
        const templateParams = {
            from_name: userName,
            from_email: userEmail,
            message: userMessage,
            reply_to: userEmail
        };
        
        await emailjs.send(
            EMAILJS_CONFIG.SERVICE_ID,
            EMAILJS_CONFIG.TEMPLATE_ID,
            templateParams
        );

        // Track successful contact form submission
        Analytics.contactForm();

        // Show success message
        form.style.display = 'none';
        successDiv.style.display = 'block';


        // Piilota kysymysteksti kun viesti on lähetetty
        const contactPrompt = document.getElementById('contact-prompt');
        if (contactPrompt) {
            contactPrompt.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Virhe viestin lähetyksessä:', error);
        alert('Viestin lähetyksessä tapahtui virhe. Yritä uudelleen.');
        
        // Reset button state
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}