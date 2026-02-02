/**
 * Extension configuration
 */
export const CONFIG = {
    EXTENSION_NAME: 'Stats',
    STORAGE_KEY: 'stats_cache',
    
    // UI IDs
    OVERLAY_ID: 'stats-overlay',
    CONTAINER_ID: 'stats-container',
    PROGRESS_BAR_ID: 'stats-progress-bar',
    STATUS_TEXT_ID: 'stats-status-text',
    COUNT_TEXT_ID: 'stats-count-text',
    
    // Menu button IDs
    WAND_BUTTON_ID: 'stats_wand_btn',
    ANALYZE_BUTTON_ID: 'stats_analyze_btn',
    
    // Batch size for fetching chats
    BATCH_SIZE: 50,
    
    // Default settings
    DEFAULT_SETTINGS: Object.freeze({
        cache: {}
    })
};
