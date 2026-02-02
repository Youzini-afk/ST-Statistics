/**
 * SillyTavern Chat Statistics Extension
 * Main entry point
 */
import './styles.css';
import { Logger } from './logger.js';
import { CONFIG } from './config.js';
import { fetchAllChats } from './api.js';
import { analyzeChats } from './analyzer.js';
import { showOverlay, generateDashboardHTML, setupDashboardEvents, closeOverlay, initCharts } from './ui.js';

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

// Abort controller for cancelling operations
let currentAbortController = null;

/**
 * Generate and display statistics report
 */
async function generateReport(forceRefresh = false) {
    // Cancel any existing operation
    if (currentAbortController) {
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const abortSignal = currentAbortController.signal;

    const context = globalThis.SillyTavern.getContext();
    const characterId = context.characterId;

    if (characterId == null) {
        toastr.warning('请先选择一个角色并进入聊天界面！', 'Stats');
        return;
    }

    const character = context.characters[characterId];
    if (!character) {
        toastr.error('无法获取角色信息。', 'Stats');
        return;
    }

    const avatarUrl = character.avatar;

    // Check cache
    if (!forceRefresh && settings.cache && settings.cache[characterId]) {
        logger.log(`Using cached stats for ${character.name}`);
        const cachedStats = settings.cache[characterId];
        const dashboardHTML = generateDashboardHTML(cachedStats, character);
        showOverlay(dashboardHTML);
        // Initialize charts for cached data
        initCharts(cachedStats);
        setupDashboardEvents(generateReport);
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
            <h3><i class="fa-solid fa-chart-simple"></i> 正在分析: ${character.name}</h3>
            <div id="stats-progress-area" style="text-align: center; width: 100%; max-width: 600px;">
                <p id="stats-status-text" style="margin-bottom: 10px;">正在扫描聊天记录...</p>
                <progress id="stats-progress-bar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                <p id="stats-count-text" style="font-size: 0.9em; color: #888; margin-top: 5px;">0 / 0</p>
            </div>
        </div>
    `);

    // Setup cancel button for loading screen
    $('.close-btn').off('click').on('click', () => {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
        closeOverlay();
    });

    try {
        // Progress callback
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

        // Fetch all chats
        const chatsData = await fetchAllChats(avatarUrl, onProgress, abortSignal);

        if (chatsData.length === 0) {
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
                        <p>该角色没有找到任何聊天记录。</p>
                    </div>
                </div>
            `);
            return;
        }

        // Analyze data
        $('#stats-status-text').text('数据读取完毕，正在计算统计指标...');
        await new Promise(resolve => setTimeout(resolve, 50));

        const stats = analyzeChats(chatsData);

        // Cache results
        if (!settings.cache) {
            settings.cache = {};
        }
        settings.cache[characterId] = stats;
        
        // Save settings
        if (globalThis.SillyTavern.saveSettingsDebounced) {
            globalThis.SillyTavern.saveSettingsDebounced();
        }

        // Display dashboard
        const dashboardHTML = generateDashboardHTML(stats, character);
        $('#stats-content-wrapper').html(dashboardHTML);
        // Initialize charts for fresh data
        initCharts(stats);
        setupDashboardEvents(generateReport);

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
                    <p>点击下方按钮分析当前角色的所有聊天记录。</p>
                    <button id="${CONFIG.ANALYZE_BUTTON_ID}" class="menu_button">
                        <i class="fa-solid fa-calculator"></i> 生成统计报告
                    </button>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(panelHTML);
    $(`#${CONFIG.ANALYZE_BUTTON_ID}`).on('click', () => generateReport(false));
}

/**
 * Initialize extension
 */
jQuery(async () => {
    try {
        // Wait for SillyTavern to be ready
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if ($('#extensions_settings').length) {
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
