/**
 * Internationalization (i18n) Module for Thaasbai
 * Supports English and Dhivehi languages
 */

const I18n = (function() {
    // Available languages
    const LANGUAGES = {
        en: { name: 'English', nativeName: 'English', dir: 'ltr' },
        dv: { name: 'Dhivehi', nativeName: 'ދިވެހި', dir: 'rtl' }
    };

    // Default language
    const DEFAULT_LANG = 'en';

    // Current language
    let currentLang = DEFAULT_LANG;

    // Loaded translations
    let translations = {};

    // Callbacks for language change
    const changeCallbacks = [];

    /**
     * Check if this is the user's first visit
     */
    function isFirstVisit() {
        return !localStorage.getItem('thaasbai_language_selected');
    }

    /**
     * Mark that user has selected a language
     */
    function markLanguageSelected() {
        localStorage.setItem('thaasbai_language_selected', 'true');
    }

    /**
     * Initialize i18n - load saved language preference and translations
     */
    async function init() {
        // Load saved language preference
        const savedLang = localStorage.getItem('thaasbai_language');
        if (savedLang && LANGUAGES[savedLang]) {
            currentLang = savedLang;
        }

        // Load translations for current language
        await loadLanguage(currentLang);

        // Also preload the other language for quick switching
        for (const lang of Object.keys(LANGUAGES)) {
            if (lang !== currentLang && !translations[lang]) {
                loadLanguage(lang); // Load in background
            }
        }

        // Apply language direction
        applyLanguageDirection();

        // Update all elements with data-i18n attributes
        updateAllTranslations();

        return currentLang;
    }

    /**
     * Load language file
     */
    async function loadLanguage(lang) {
        if (!LANGUAGES[lang]) {
            console.error(`Language '${lang}' not supported`);
            return false;
        }

        try {
            const response = await fetch(`/lang/${lang}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load language file: ${response.status}`);
            }
            translations[lang] = await response.json();
            return true;
        } catch (error) {
            console.error(`Error loading language '${lang}':`, error);
            // Fall back to English if available
            if (lang !== 'en' && translations['en']) {
                console.log('Falling back to English');
            }
            return false;
        }
    }

    /**
     * Get translation for a key
     * @param {string} key - Dot-notation key (e.g., 'common.loading')
     * @param {object} params - Optional parameters for interpolation
     * @returns {string} Translated string
     */
    function t(key, params = {}) {
        const langData = translations[currentLang] || translations['en'] || {};

        // Navigate nested keys
        const keys = key.split('.');
        let value = langData;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                // Key not found, return the key itself
                console.warn(`Translation key not found: ${key}`);
                return key;
            }
        }

        if (typeof value !== 'string') {
            return key;
        }

        // Interpolate parameters
        return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
            return params[paramKey] !== undefined ? params[paramKey] : match;
        });
    }

    /**
     * Change current language
     */
    async function setLanguage(lang) {
        if (!LANGUAGES[lang]) {
            console.error(`Language '${lang}' not supported`);
            return false;
        }

        if (lang === currentLang) {
            return true;
        }

        // Load translations if not already loaded
        if (!translations[lang]) {
            const loaded = await loadLanguage(lang);
            if (!loaded) return false;
        }

        currentLang = lang;
        localStorage.setItem('thaasbai_language', lang);

        // Apply language direction
        applyLanguageDirection();

        // Update all translations
        updateAllTranslations();

        // Notify callbacks
        changeCallbacks.forEach(cb => cb(lang));

        return true;
    }

    /**
     * Get current language
     */
    function getLanguage() {
        return currentLang;
    }

    /**
     * Get all available languages
     */
    function getLanguages() {
        return { ...LANGUAGES };
    }

    /**
     * Check if current language is Dhivehi
     */
    function isDhivehi() {
        return currentLang === 'dv';
    }

    /**
     * Apply language class to document (font only, no direction change)
     */
    function applyLanguageDirection() {
        // Always keep LTR direction, only change font via class
        document.documentElement.setAttribute('lang', currentLang);

        // Add/remove class for Dhivehi font styling (no layout direction change)
        if (currentLang === 'dv') {
            document.body.classList.add('rtl');
        } else {
            document.body.classList.remove('rtl');
        }
    }

    /**
     * Update all elements with data-i18n attribute
     */
    function updateAllTranslations() {
        // Update text content
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });

        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = t(key);
        });

        // Update titles
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = t(key);
        });

        // Update aria-labels
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            el.setAttribute('aria-label', t(key));
        });
    }

    /**
     * Register callback for language change
     */
    function onLanguageChange(callback) {
        if (typeof callback === 'function') {
            changeCallbacks.push(callback);
        }
    }

    /**
     * Remove callback for language change
     */
    function offLanguageChange(callback) {
        const index = changeCallbacks.indexOf(callback);
        if (index > -1) {
            changeCallbacks.splice(index, 1);
        }
    }

    /**
     * Create language switcher dropdown HTML
     */
    function createLanguageSwitcher(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const html = `
            <div class="language-switcher">
                <button class="lang-btn" id="lang-toggle" aria-label="Change language">
                    <span class="lang-icon">🌐</span>
                    <span class="lang-current">${LANGUAGES[currentLang].nativeName}</span>
                </button>
                <div class="lang-dropdown hidden" id="lang-dropdown">
                    ${Object.entries(LANGUAGES).map(([code, lang]) => `
                        <button class="lang-option ${code === currentLang ? 'active' : ''}"
                                data-lang="${code}">
                            ${lang.nativeName}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Add event listeners
        const toggle = container.querySelector('#lang-toggle');
        const dropdown = container.querySelector('#lang-dropdown');
        const options = container.querySelectorAll('.lang-option');

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        options.forEach(option => {
            option.addEventListener('click', async () => {
                const lang = option.getAttribute('data-lang');
                await setLanguage(lang);

                // Update UI
                container.querySelector('.lang-current').textContent = LANGUAGES[lang].nativeName;
                options.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                dropdown.classList.add('hidden');
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });
    }

    /**
     * Show first-use language selection prompt
     * Returns a promise that resolves when user selects a language
     */
    function showLanguagePrompt() {
        return new Promise((resolve) => {
            // Create modal overlay
            const modal = document.createElement('div');
            modal.id = 'language-select-modal';
            modal.className = 'lang-select-modal';
            modal.innerHTML = `
                <div class="lang-select-content">
                    <div class="lang-select-header">
                        <h2>Select Language</h2>
                        <p>ބަސް އިޚްތިޔާރު ކުރައްވާ</p>
                    </div>
                    <div class="lang-select-options">
                        ${Object.entries(LANGUAGES).map(([code, lang]) => `
                            <button class="lang-select-btn" data-lang="${code}">
                                <span class="lang-select-native">${lang.nativeName}</span>
                                <span class="lang-select-name">${lang.name}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Add click handlers
            modal.querySelectorAll('.lang-select-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const lang = btn.getAttribute('data-lang');
                    await setLanguage(lang);
                    markLanguageSelected();

                    // Animate out
                    modal.classList.add('fade-out');
                    setTimeout(() => {
                        modal.remove();
                        resolve(lang);
                    }, 300);
                });
            });
        });
    }

    /**
     * Initialize with first-use prompt if needed
     */
    async function initWithPrompt() {
        await init();

        if (isFirstVisit()) {
            await showLanguagePrompt();
        }

        return currentLang;
    }

    // Public API
    return {
        init,
        initWithPrompt,
        t,
        setLanguage,
        getLanguage,
        getLanguages,
        isDhivehi,
        isFirstVisit,
        updateAllTranslations,
        onLanguageChange,
        offLanguageChange,
        createLanguageSwitcher,
        showLanguagePrompt
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18n;
}
