/**
 * SillyTavern Chat Statistics Extension
 * Main entry point
 */
import './styles.css';
import { Logger } from './logger.js';
import { CONFIG } from './config.js';
import { fetchAllChats, fetchAllCharactersChats } from './api.js';
import { analyzeChats, parseDate } from './analyzer.js';
import { showOverlay, generateDashboardHTML, setupDashboardEvents, closeOverlay, initCharts, THEMES } from './ui.js';

const logger = new Logger('Stats');

// Get extension settings
const { extensionSettings } = globalThis.SillyTavern.getContext();
const EXTENSION_NAME = CONFIG.EXTENSION_NAME;

// Initialize settings
if (!extensionSettings[EXTENSION_NAME]) {
    logger.log('Initializing default settings for the first time.');
    extensionSettings[EXTENSION_NAME] = structuredClone(CONFIG.DEFAULT_SETTINGS);
}

const settings = extensionSettings[EXTENSION_NAME];

// Ensure default theme is set (for existing users)
if (!settings.theme) {
    settings.theme = CONFIG.DEFAULT_SETTINGS.theme || 'violet';
}

// Abort controller for cancelling operations
let currentAbortController = null;

/**
 * Generate and display statistics report
 * @param {boolean} forceRefresh - Force refresh data
 * @param {boolean} globalMode - Generate global stats for all characters
 */
async function generateReport(forceRefresh = false, globalMode = false, dateRange = null) {
    // Cancel any existing operation
    if (currentAbortController) {
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const abortSignal = currentAbortController.signal;

    const context = globalThis.SillyTavern.getContext();
    const characterId = context.characterId;

    // Determine mode: if no character selected, use global mode
    const isGlobalMode = globalMode || characterId == null;

    let character = null;
    let avatarUrl = null;
    let cacheKey = null;

    if (!isGlobalMode) {
        character = context.characters[characterId];
        if (!character) {
            toastr.error('无法获取角色信息。', 'Stats');
            return;
        }
        avatarUrl = character.avatar;
        cacheKey = characterId;
    } else {
        cacheKey = '__global__';
    }

    const rangeKey = dateRange && (dateRange.start || dateRange.end)
        ? `__${dateRange.start || ''}_${dateRange.end || ''}`
        : '';
    cacheKey = `${cacheKey}${rangeKey}`;

    const reportTitle = isGlobalMode ? '全部角色统计' : character.name;

    // Helper to setup events with correct context
    const bindEvents = (statsToUse) => {
        setupDashboardEvents((force, range, newTheme) => {
            if (newTheme) {
                // Update theme setting
                settings.theme = newTheme;
                if (globalThis.SillyTavern.saveSettingsDebounced) {
                    globalThis.SillyTavern.saveSettingsDebounced();
                }
                
                // Re-render dashboard with new theme (no data fetch needed)
                const html = generateDashboardHTML(statsToUse, isGlobalMode ? null : character, isGlobalMode, settings.theme);
                $('#stats-content-wrapper').html(html);
                
                // Update overlay theme
                const themeClass = (THEMES[newTheme] || THEMES.violet).class;
                $('#stats-overlay').removeClass().addClass(themeClass);

                initCharts(statsToUse, settings.theme);
                // Re-bind events
                bindEvents(statsToUse);
            } else {
                // Refresh data or date range
                generateReport(force, isGlobalMode, range);
            }
        });
    };

    // Check cache
    if (!forceRefresh && settings.cache && settings.cache[cacheKey]) {
        logger.log(`Using cached stats for ${reportTitle}`);
        const cachedEntry = settings.cache[cacheKey];
        const cachedStats = cachedEntry.stats ? cachedEntry.stats : cachedEntry;
        if (!cachedStats.__meta) {
            const dateRangeFromCache = cachedEntry.dateRange || dateRange || null;
            const dateBoundsFromCache = cachedEntry.dateBounds || null;
            cachedStats.__meta = { dateRange: dateRangeFromCache, dateBounds: dateBoundsFromCache };
        }
        const dashboardHTML = generateDashboardHTML(cachedStats, isGlobalMode ? null : character, isGlobalMode, settings.theme);
        showOverlay(dashboardHTML, settings.theme);
        // Initialize charts for cached data
        initCharts(cachedStats, settings.theme);
        bindEvents(cachedStats);
        toastr.success('已加载缓存的统计报告。', 'Stats');
        return;
    }

    // Show loading overlay
    showOverlay(`
        <div id="stats-container" class="stats-dashboard" style="min-height: 300px; justify-content: center; align-items: center;">
            <div class="stats-actions">
                <div class="stats-btn refresh-btn" title="刷新数据 (Refresh)">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </div>
                <div class="stats-btn download-btn" title="Save as Image">
                    <i class="fa-solid fa-download"></i>
                </div>
                <div class="stats-btn close-btn" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                </div>
            </div>
            <h3><i class="fa-solid fa-chart-simple"></i> 正在分析: ${reportTitle}</h3>
            <div id="stats-progress-area" style="text-align: center; width: 100%; max-width: 600px;">
                <p id="stats-status-text" style="margin-bottom: 10px;">正在扫描聊天记录...</p>
                <progress id="stats-progress-bar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                <p id="stats-count-text" style="font-size: 0.9em; color: #888; margin-top: 5px;">0 / 0</p>
            </div>
        </div>
    `, settings.theme);

    // Setup cancel button for loading screen
    $('.close-btn').off('click').on('click', () => {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
        closeOverlay();
    });

    try {
        let chatsData;

        if (isGlobalMode) {
            // Progress callback for global mode
            const onProgress = (currentChar, totalChars, totalChats) => {
                const percentage = Math.round((currentChar / totalChars) * 100);
                $('#stats-progress-bar').val(percentage);
                $('#stats-count-text').text(`角色 ${currentChar} / ${totalChars}，共 ${totalChats} 个聊天`);
                $('#stats-status-text').text(`正在扫描所有角色: ${percentage}%`);
            };

            chatsData = await fetchAllCharactersChats(onProgress, abortSignal);
        } else {
            // Progress callback for single character
            const onProgress = (current, total) => {
                if (total > 5) {
                    const percentage = Math.round((current / total) * 100);
                    $('#stats-progress-bar').val(percentage);
                    $('#stats-count-text').text(`${current} / ${total}`);
                    $('#stats-status-text').text(`正在读取: ${percentage}%`);
                } else {
                    $('#stats-status-text').text('正在读取数据...');
                }
            };

            chatsData = await fetchAllChats(avatarUrl, onProgress, abortSignal);
        }

        if (chatsData.length === 0) {
            const emptyMessage = isGlobalMode ? '没有找到任何聊天记录。' : '该角色没有找到任何聊天记录。';
            $('#stats-content-wrapper').html(`
                <div class="stats-dashboard" style="justify-content: center; align-items: center; min-height: 200px;">
                    <div class="stats-actions">
                        <div class="stats-btn refresh-btn" title="刷新数据 (Refresh)">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </div>
                        <div class="stats-btn download-btn" title="Save as Image">
                            <i class="fa-solid fa-download"></i>
                        </div>
                        <div class="stats-btn close-btn" title="Close">
                            <i class="fa-solid fa-xmark"></i>
                        </div>
                    </div>
                    <div style="text-align: center;">
                        <i class="fa-solid fa-circle-exclamation fa-3x" style="color: #ffcc00; margin-bottom: 15px;"></i>
                        <p>${emptyMessage}</p>
                    </div>
                </div>
            `);
            return;
        }

        // Compute date bounds from all chats (for range picker)
        let minDate = null;
        let maxDate = null;
        chatsData.forEach(chat => {
            chat.messages.forEach(msg => {
                const date = parseDate(msg.send_date);
                if (!date) return;
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
            });
        });

        const dateBounds = {
            min: minDate ? minDate.toISOString().split('T')[0] : '',
            max: maxDate ? maxDate.toISOString().split('T')[0] : ''
        };

        const normalizedRange = {
            start: dateRange?.start || dateBounds.min || '',
            end: dateRange?.end || dateBounds.max || ''
        };

        // Analyze data
        $('#stats-status-text').text('数据读取完毕，正在计算统计指标...');
        await new Promise(resolve => setTimeout(resolve, 50));

        const stats = analyzeChats(chatsData, {
            startDate: normalizedRange.start,
            endDate: normalizedRange.end
        });
        stats.__meta = { dateRange: normalizedRange, dateBounds };

        // Cache results
        if (!settings.cache) {
            settings.cache = {};
        }
        settings.cache[cacheKey] = { stats, dateRange: normalizedRange, dateBounds };
        
        // Save settings
        if (globalThis.SillyTavern.saveSettingsDebounced) {
            globalThis.SillyTavern.saveSettingsDebounced();
        }

        // Display dashboard
        const dashboardHTML = generateDashboardHTML(stats, isGlobalMode ? null : character, isGlobalMode, settings.theme);
        $('#stats-content-wrapper').html(dashboardHTML);
        // Initialize charts for fresh data
        initCharts(stats, settings.theme);
        bindEvents(stats);

        toastr.success('统计报告生成完毕！', 'Stats');

    } catch (error) {
        logger.error('Report generation failed:', error);
        $('#stats-content-wrapper').html(`
            <div class="stats-dashboard" style="justify-content: center; align-items: center; min-height: 200px;">
                <div class="stats-actions">
                    <div class="stats-btn refresh-btn" title="刷新数据 (Refresh)">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </div>
                    <div class="stats-btn download-btn" title="Save as Image">
                        <i class="fa-solid fa-download"></i>
                    </div>
                    <div class="stats-btn close-btn" title="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </div>
                </div>
                <div style="text-align: center;">
                    <i class="fa-solid fa-triangle-exclamation fa-3x" style="color: #ff0000; margin-bottom: 15px;"></i>
                    <p style="color:red;">生成报告失败: ${error.message}</p>
                </div>
            </div>
        `);
    }
}

/**
 * Add button to wand menu
 */
function addWandMenuButton() {
    const buttonId = CONFIG.WAND_BUTTON_ID;
    
    if ($(`#${buttonId}`).length > 0) {
        return; // Already exists
    }

    const buttonHTML = `
        <div id="${buttonId}" class="list-group-item flex-container flexGap5 interactable">
            <div class="fa-solid fa-chart-pie"></div>
            <span>聊天统计报告</span>
        </div>
    `;

    const extensionsMenu = $('#extensionsMenu');
    if (extensionsMenu.length > 0) {
        extensionsMenu.append(buttonHTML);
        $(`#${buttonId}`).on('click', () => {
            generateReport(false);
        });
        logger.log('Added Wand Menu button.');
    } else {
        logger.warn('Wand menu container (#extensionsMenu) not found.');
    }
}

/**
 * Add settings panel
 */
function addSettingsPanel() {
    const panelHTML = `
        <div class="stats-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>聊天统计</b>
                    <div class="inline-drawer-icon fa-solid fa-chart-bar down"></div>
                </div>
                <div class="inline-drawer-content stats-drawer">
                    <p>分析聊天记录并生成统计报告。</p>
                    <button id="${CONFIG.ANALYZE_BUTTON_ID}" class="menu_button">
                        <i class="fa-solid fa-calculator"></i> 当前角色统计
                    </button>
                    <button id="${CONFIG.ANALYZE_BUTTON_ID}_global" class="menu_button" style="margin-top: 5px;">
                        <i class="fa-solid fa-globe"></i> 全部角色统计
                    </button>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(panelHTML);
    $(`#${CONFIG.ANALYZE_BUTTON_ID}`).on('click', () => generateReport(false, false));
    $(`#${CONFIG.ANALYZE_BUTTON_ID}_global`).on('click', () => generateReport(false, true));
}

/**
 * Initialize extension
 */
jQuery(async () => {
    try {
        // Wait for SillyTavern to be ready
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (globalThis.SillyTavern?.getContext) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });

        // Add UI elements
        addSettingsPanel();
        addWandMenuButton();

        logger.log('Extension initialized.');
    } catch (error) {
        logger.error('Initialization failed:', error);
    }
});
