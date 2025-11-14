// GDPR Cookie Consent Manager
// Universaali cookie-banneri kaikille sivuille

class CookieConsent {
    constructor() {
        this.COOKIE_NAME = 'inflaatio_cookie_consent';
        this.ANALYTICS_ACCEPTED = 'analytics_accepted';
        this.COOKIE_DURATION = 365; // päivää
        this.GA_MEASUREMENT_ID = 'G-Y6YW3W445P'; // Korvaa oikealla Google Analytics ID:llä
        
        this.init();
    }

    init() {
        // Tarkista onko suostumus jo annettu
        const consent = this.getCookieConsent();
        
        if (!consent) {
            this.showCookieBanner();
        } else {
            // Jos analytiikka on hyväksytty, lataa Google Analytics
            if (consent.analytics) {
                this.loadGoogleAnalytics();
            }
        }
        
        // Kuuntele custom eventejä cookie-asetusten muutoksille
        document.addEventListener('updateCookieSettings', (e) => {
            this.updateConsent(e.detail);
        });
    }

    getCookieConsent() {
        const cookie = this.getCookie(this.COOKIE_NAME);
        if (cookie) {
            try {
                return JSON.parse(cookie);
            } catch (e) {
                console.warn('Cookie consent parsing failed');
                return null;
            }
        }
        return null;
    }

    setCookieConsent(consent) {
        const consentData = {
            analytics: consent.analytics || false,
            necessary: true, // Aina true
            timestamp: new Date().toISOString()
        };
        
        this.setCookie(this.COOKIE_NAME, JSON.stringify(consentData), this.COOKIE_DURATION);
        
        // Jos analytiikka hyväksyttiin, lataa Google Analytics
        if (consentData.analytics) {
            this.loadGoogleAnalytics();
        }
        
        return consentData;
    }

    showCookieBanner() {
        // Luo banner elementti
        const banner = this.createCookieBanner();
        document.body.appendChild(banner);
        
        // Animoi sisään
        setTimeout(() => {
            banner.classList.add('show');
        }, 100);
    }

    hideCookieBanner() {
        const banner = document.getElementById('cookieConsentBanner');
        if (banner) {
            banner.classList.remove('show');
            setTimeout(() => {
                if (banner.parentNode) {
                    banner.parentNode.removeChild(banner);
                }
            }, 300);
        }
    }

    createCookieBanner() {
        const banner = document.createElement('div');
        banner.id = 'cookieConsentBanner';
        banner.className = 'cookie-consent-banner';
        
        banner.innerHTML = `
            <div class="cookie-banner-content">
                <div class="cookie-banner-text">
                    <div class="cookie-banner-icon">🍪</div>
                    <div class="cookie-banner-info">
                        <h3>Evästeiden käyttö</h3>
                        <p>Käytämme välttämättömiä evästeitä sivuston toiminnallisuuden varmistamiseksi. Analytiikkaevästeet auttavat parantamaan käyttökokemusta.</p>
                    </div>
                </div>
                <div class="cookie-banner-actions">
                    <button class="cookie-btn cookie-btn-secondary" id="cookieSettings">
                        Asetukset
                    </button>
                    <button class="cookie-btn cookie-btn-decline" id="cookieDecline">
                        Hylkää valinnaiset
                    </button>
                    <button class="cookie-btn cookie-btn-accept" id="cookieAccept">
                        Hyväksy kaikki
                    </button>
                </div>
            </div>
        `;
        
        // Lisää event listenerit
        banner.querySelector('#cookieAccept').addEventListener('click', () => {
            this.acceptAll();
        });
        
        banner.querySelector('#cookieDecline').addEventListener('click', () => {
            this.declineOptional();
        });
        
        banner.querySelector('#cookieSettings').addEventListener('click', () => {
            this.showCookieSettings();
        });
        
        return banner;
    }

    showCookieSettings() {
        const modal = this.createSettingsModal();
        document.body.appendChild(modal);
        
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }

    createSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'cookieSettingsModal';
        modal.className = 'cookie-settings-modal';
        
        modal.innerHTML = `
            <div class="cookie-modal-overlay"></div>
            <div class="cookie-modal-content">
                <div class="cookie-modal-header">
                    <h2>Evästeasetukset</h2>
                    <button class="cookie-modal-close" id="closeSettingsModal">&times;</button>
                </div>
                
                <div class="cookie-modal-body">
                    <p class="cookie-modal-description">
                        Voit hallita evästeasetuksiasi alla. Välttämättömät evästeet ovat aina käytössä sivuston perustoimintojen takaamiseksi.
                    </p>
                    
                    <div class="cookie-categories">
                        <div class="cookie-category">
                            <div class="cookie-category-header">
                                <div class="cookie-category-info">
                                    <h4>Välttämättömät evästeet</h4>
                                    <p>Nämä evästeet ovat välttämättömiä sivuston perustoimintojen kannalta.</p>
                                </div>
                                <div class="cookie-toggle">
                                    <input type="checkbox" id="necessaryCookies" checked disabled>
                                    <label for="necessaryCookies" class="toggle-label">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        
                        <div class="cookie-category">
                            <div class="cookie-category-header">
                                <div class="cookie-category-info">
                                    <h4>Analytiikkaevästeet</h4>
                                    <p>Google Analytics auttaa ymmärtämään sivuston käyttöä ja parantamaan palvelua.</p>
                                </div>
                                <div class="cookie-toggle">
                                    <input type="checkbox" id="analyticsCookies">
                                    <label for="analyticsCookies" class="toggle-label">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="cookie-modal-actions">
                        <button class="cookie-btn cookie-btn-secondary" id="saveSettingsDecline">
                            Tallenna valinta
                        </button>
                        <button class="cookie-btn cookie-btn-accept" id="saveSettingsAccept">
                            Hyväksy valinnat
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Event listenerit
        modal.querySelector('#closeSettingsModal').addEventListener('click', () => {
            this.hideSettingsModal();
        });
        
        modal.querySelector('.cookie-modal-overlay').addEventListener('click', () => {
            this.hideSettingsModal();
        });
        
        modal.querySelector('#saveSettingsAccept').addEventListener('click', () => {
            this.saveSettings();
        });
        
        modal.querySelector('#saveSettingsDecline').addEventListener('click', () => {
            this.saveSettings();
        });
        
        // KORJAUS: Aseta nykyinen cookie-tila checkboxeihin
        setTimeout(() => {
            this.setCurrentCookieStates(modal);
        }, 50);
        
        return modal;
    }

    // UUSI FUNKTIO: Asettaa checkboxien tilan nykyisten cookie-asetusten mukaan
    setCurrentCookieStates(modal) {
        const consent = this.getCookieConsent();
        const analyticsCheckbox = modal.querySelector('#analyticsCookies');
        
        console.log('Setting cookie states. Current consent:', consent);
        
        if (analyticsCheckbox) {
            // Aseta analytics checkbox nykyisen suostumuksen mukaan
            analyticsCheckbox.checked = consent && consent.analytics;
            console.log('Analytics checkbox set to:', analyticsCheckbox.checked);
            
            // Pakota CSS:n päivitys lisäämällä/poistamalla checked attribuutti
            if (analyticsCheckbox.checked) {
                analyticsCheckbox.setAttribute('checked', 'checked');
            } else {
                analyticsCheckbox.removeAttribute('checked');
            }
            
            // Trigger change event jotta CSS päivittyy varmasti
            analyticsCheckbox.dispatchEvent(new Event('change'));
        }
    }

    hideSettingsModal() {
        const modal = document.getElementById('cookieSettingsModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            }, 300);
        }
    }

    acceptAll() {
        const consent = this.setCookieConsent({
            analytics: true
        });
        this.hideCookieBanner();
        this.showConsentNotification('Kaikki evästeet hyväksytty');

        // Track cookie acceptance (anonymous)
        if (window.Analytics) {
            console.log('✅ Tracking cookie accept');
            window.Analytics.cookieAccept();
        } else {
            console.warn('⚠️ Analytics not defined yet, retrying...');
            setTimeout(() => {
                if (window.Analytics) {
                    window.Analytics.cookieAccept();
                }
            }, 1000);
        }

        // Trigger event muille sovelluksille
        this.triggerConsentEvent(consent);
    }

    declineOptional() {
        const consent = this.setCookieConsent({
            analytics: false
        });
        this.hideCookieBanner();
        this.showConsentNotification('Vain välttämättömät evästeet hyväksytty');

        // Track cookie decline (anonymous)
        if (window.Analytics) {
            console.log('✅ Tracking cookie decline');
            window.Analytics.cookieDecline();
        } else {
            console.warn('⚠️ Analytics not defined yet, retrying...');
            setTimeout(() => {
                if (window.Analytics) {
                    window.Analytics.cookieDecline();
                }
            }, 1000);
        }

        // Trigger event
        this.triggerConsentEvent(consent);
    }

    saveSettings() {
        const analyticsCheckbox = document.getElementById('analyticsCookies');
        const analyticsAccepted = analyticsCheckbox ? analyticsCheckbox.checked : false;
        
        console.log('Saving settings. Analytics accepted:', analyticsAccepted);
        
        const consent = this.setCookieConsent({
            analytics: analyticsAccepted
        });
        
        this.hideSettingsModal();
        this.hideCookieBanner();
        
        const message = analyticsAccepted ? 
            'Evästeasetukset tallennettu - Analytics käytössä' : 
            'Evästeasetukset tallennettu - Vain välttämättömät';
        this.showConsentNotification(message);
        
        // Trigger event
        this.triggerConsentEvent(consent);
    }

    showConsentNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'cookie-notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    triggerConsentEvent(consent) {
        const event = new CustomEvent('cookieConsentUpdated', {
            detail: consent
        });
        document.dispatchEvent(event);
    }

    updateConsent(newConsent) {
        const currentConsent = this.getCookieConsent();
        if (currentConsent) {
            const updatedConsent = { ...currentConsent, ...newConsent };
            this.setCookieConsent(updatedConsent);
        }
    }

    loadGoogleAnalytics() {
        // Tarkista ettei ole jo ladattu
        if (window.gtag || document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${this.GA_MEASUREMENT_ID}"]`)) {
            console.log('Google Analytics already loaded');
            return;
        }

        console.log('Loading Google Analytics...');
        
        // Lataa Google Analytics
        const script1 = document.createElement('script');
        script1.async = true;
        script1.src = `https://www.googletagmanager.com/gtag/js?id=${this.GA_MEASUREMENT_ID}`;
        document.head.appendChild(script1);
        
        // Alusta gtag
        const script2 = document.createElement('script');
        script2.textContent = `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${this.GA_MEASUREMENT_ID}', {
                anonymize_ip: true,
                cookie_flags: 'SameSite=Strict;Secure'
            });
        `;
        document.head.appendChild(script2);
        
        // Aseta globaali gtag funktio
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        
        console.log('Google Analytics loaded with privacy settings');
    }

    // Utility methods
    setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict;Secure`;
    }

    getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    // Public API methods
    static getInstance() {
        if (!window.cookieConsentInstance) {
            window.cookieConsentInstance = new CookieConsent();
        }
        return window.cookieConsentInstance;
    }

    static hasAnalyticsConsent() {
        const instance = CookieConsent.getInstance();
        const consent = instance.getCookieConsent();
        return consent && consent.analytics;
    }

    static updateCookieSettings(newSettings) {
        const event = new CustomEvent('updateCookieSettings', {
            detail: newSettings
        });
        document.dispatchEvent(event);
    }

    static showCookieSettings() {
        const instance = CookieConsent.getInstance();
        instance.showCookieSettings();
    }
}

// Auto-init kun DOM on valmis
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        CookieConsent.getInstance();
    });
} else {
    CookieConsent.getInstance();
}

// Export for use in other scripts
window.CookieConsent = CookieConsent;