/**
 * UI rendering functions
 */
import html2canvas from 'html2canvas';
import { Logger } from './logger.js';
import Chart from 'chart.js/auto';

const logger = new Logger('Stats-UI');
let charts = {}; // Store chart instances to destroy them later

// Theme definitions
export const THEMES = {
    violet: { name: 'Violet', class: '', color: '139, 92, 246', hex: '#8b5cf6' },
    blue: { name: 'Blue', class: 'theme-blue', color: '59, 130, 246', hex: '#3b82f6' },
    emerald: { name: 'Emerald', class: 'theme-emerald', color: '16, 185, 129', hex: '#10b981' },
    amber: { name: 'Amber', class: 'theme-amber', color: '245, 158, 11', hex: '#f59e0b' },
    rose: { name: 'Rose', class: 'theme-rose', color: '244, 63, 94', hex: '#f43f5e' }
};

const THEME_ORDER = ['violet', 'blue', 'emerald', 'amber', 'rose'];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey) {
    if (!dateKey) return null;
    const parts = String(dateKey).split('-').map((p) => Number(p));
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
}

/**
 * Cleanup existing charts
 */
function cleanupCharts() {
    Object.values(charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    charts = {};
}

/**
 * Format large numbers (e.g., 150000 -> 150k)
 */
function formatNumber(num) {
    if (num >= 100000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toLocaleString();
}

/**
 * Generate 24-hour heatmap HTML (Visual Gradient Strip)
 */
function generateHourlyHeatmapHTML(hourlyActivity, themeColor = '139, 92, 246') {
    const maxCount = Math.max(...hourlyActivity, 1);
    
    let heatmapHTML = `<div class="hourly-heatmap-container" style="margin-top: 15px;">`;
    
    // Hour labels top
    heatmapHTML += `<div style="display: flex; justify-content: space-between; padding: 0 2px; margin-bottom: 5px; font-size: 0.7em; color: var(--st-text-muted);">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
    </div>`;

    // The strip
    heatmapHTML += `<div class="hourly-heatmap-strip" style="display: flex; height: 36px; border-radius: 6px; overflow: hidden; gap: 1px;">`;
    for (let i = 0; i < 24; i++) {
        const count = hourlyActivity[i];
        const alpha = count > 0 ? 0.3 + (count / maxCount) * 0.7 : 0.05;
        heatmapHTML += `
            <div class="hourly-heatmap-cell" 
                 title="${i}:00 - ${i}:59 : ${count} messages"
                 style="flex: 1; background-color: rgba(${themeColor}, ${alpha}); position: relative; cursor: help;">
            </div>
        `;
    }
    heatmapHTML += `</div>`;
    
    heatmapHTML += `</div>`;
    return heatmapHTML;
}

/**
 * Render Chart.js charts after DOM insertion
 */
export function initCharts(stats, themeKey = 'violet') {
    cleanupCharts();

    const theme = THEMES[themeKey] || THEMES.violet;
    const colorRGB = theme.color;
    const colorHex = theme.hex;
    const range = stats.__meta?.dateRange || null;

    // 1. Timeline Chart (Bar Chart for Daily Activity)
    const ctxTimeline = document.getElementById('timelineChart');
    // Try ISO format first, fall back to dailyActivity keys
    let firstDateStr = range?.start || stats.overview.firstDateISO;
    if (!firstDateStr && stats.dailyActivity) {
        const sortedDates = Object.keys(stats.dailyActivity).sort();
        if (sortedDates.length > 0) firstDateStr = sortedDates[0];
    }
    let lastDateStr = range?.end || stats.overview.lastDateISO;
    if (!lastDateStr && stats.dailyActivity) {
        const sortedDates = Object.keys(stats.dailyActivity).sort();
        if (sortedDates.length > 0) lastDateStr = sortedDates[sortedDates.length - 1];
    }
    if (ctxTimeline && firstDateStr && lastDateStr) {
        const firstDateObj = parseLocalDateKey(firstDateStr);
        const endDate = parseLocalDateKey(lastDateStr);
        if (firstDateObj && endDate && !isNaN(firstDateObj.getTime()) && !isNaN(endDate.getTime())) {
            const dates = [];
            let currentDate = new Date(firstDateObj);
            
            let safety = 0;
            while (currentDate <= endDate && safety < 10000) {
                dates.push(formatLocalDateKey(currentDate));
                currentDate.setDate(currentDate.getDate() + 1);
                safety++;
            }

            const dataPoints = dates.map(date => stats.dailyActivity[date] || 0);

            charts.timeline = new Chart(ctxTimeline, {
                type: 'bar',
                data: {
                    labels: dates,
                    datasets: [{
                        label: '每日消息数量',
                        data: dataPoints,
                        backgroundColor: `rgba(${colorRGB}, 0.6)`,
                        borderColor: `rgba(${colorRGB}, 1)`,
                        borderWidth: 1,
                        barPercentage: 0.8,
                        categoryPercentage: 0.9,
                        borderRadius: 2,
                        maxBarThickness: 50
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            callbacks: {
                                title: (items) => `日期: ${items[0].label}`,
                                label: (item) => `消息: ${item.raw}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: { display: false },
                            ticks: {
                                color: '#9ca3af',
                                maxTicksLimit: 12
                            }
                        },
                        y: {
                            display: true,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#9ca3af' },
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    }

    // 2. Hourly Activity Chart (Line Chart)
    const ctxHourly = document.getElementById('hourlyChart');
    if (ctxHourly) {
        charts.hourly = new Chart(ctxHourly, {
            type: 'line',
            data: {
                labels: Array.from({length: 24}, (_, i) => i),
                datasets: [{
                    label: '消息数量',
                    data: stats.hourlyActivity,
                    borderColor: `rgba(${colorRGB}, 1)`,
                    backgroundColor: `rgba(${colorRGB}, 0.1)`,
                    borderWidth: 2,
                    pointBackgroundColor: `rgba(${colorRGB}, 1)`,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.4 // Smooth curve
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: (items) => `时间: ${items[0].label}:00 - ${items[0].label}:59`,
                            label: (item) => `消息: ${item.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af', stepSize: 3 }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9ca3af' },
                        beginAtZero: true
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }

    // 3. Model Preference (Pie Chart)
    const ctxModel = document.getElementById('modelPieChart');
    if (ctxModel) {
        const modelEntries = Object.entries(stats.models).sort(([, a], [, b]) => b - a);
        
        let labels = [];
        let data = [];
        
        if (modelEntries.length > 10) {
            const top10 = modelEntries.slice(0, 10);
            const others = modelEntries.slice(10);
            labels = top10.map(e => e[0]);
            data = top10.map(e => e[1]);
            const otherCount = others.reduce((sum, e) => sum + e[1], 0);
            labels.push('Others');
            data.push(otherCount);
        } else {
            labels = modelEntries.map(e => e[0]);
            data = modelEntries.map(e => e[1]);
        }

        // Generate colors based on theme but varied
        const bgColors = [
            `rgba(${colorRGB}, 0.8)`, // Primary
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(236, 72, 153, 0.8)',
            'rgba(99, 102, 241, 0.8)',
            'rgba(20, 184, 166, 0.8)',
            'rgba(217, 70, 239, 0.8)',
            'rgba(249, 115, 22, 0.8)'
        ];

        // Ensure the first color matches theme (if not already handled by manual array)
        if (themeKey !== 'violet') {
             // Just keeping the array is simpler, chartjs will cycle or we can construct it dynamically
             // For now, let's just make the FIRST one the theme color
             bgColors[0] = `rgba(${colorRGB}, 0.8)`;
        }

        charts.model = new Chart(ctxModel, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#e5e7eb',
                            boxWidth: 10,
                            font: { size: 10 }
                        }
                    }
                },
                cutout: '60%'
            }
        });
    }

    // 4. Character Ranking (Horizontal Bar Chart - Global Mode Only)
    const ctxCharRanking = document.getElementById('characterRankingChart');
    if (ctxCharRanking && stats.characterStats) {
        // 按消息数排序，取前 20 个
        const charEntries = Object.entries(stats.characterStats)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20);

        if (charEntries.length === 0) return;
        
        const charLabels = charEntries.map(e => e[0]);
        const charData = charEntries.map(e => e[1]);

        charts.charRanking = new Chart(ctxCharRanking, {
            type: 'bar',
            data: {
                labels: charLabels,
                datasets: [{
                    label: '消息数',
                    data: charData,
                    backgroundColor: `rgba(${colorRGB}, 0.7)`,
                    borderColor: `rgba(${colorRGB}, 1)`,
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y', // 横向柱状图
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => items[0].label,
                            label: (item) => `消息数: ${item.raw.toLocaleString()}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9ca3af' },
                        beginAtZero: true
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: '#e5e7eb',
                            font: { size: 11 }
                        }
                    }
                }
            }
        });
    }

    // 5. Duration Gauge Chart (Doughnut)
    const ctxDurationGauge = document.getElementById('durationGaugeChart');
    if (ctxDurationGauge && stats.overview.totalDurationMinutes !== undefined) {
        const totalMinutes = stats.overview.totalDurationMinutes || 0;
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const displayText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

        // Create a gauge-style doughnut chart
        charts.durationGauge = new Chart(ctxDurationGauge, {
            type: 'doughnut',
            data: {
                labels: ['已使用时长', ''],
                datasets: [{
                    data: [totalMinutes, Math.max(0, 100 - (totalMinutes % 100))], // Visual gauge effect
                    backgroundColor: [
                        `rgba(${colorRGB}, 0.9)`,
                        'rgba(255, 255, 255, 0.05)'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                rotation: -90,
                circumference: 180,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            },
            plugins: [{
                id: 'centerText',
                afterDraw: (chart) => {
                    const ctx = chart.ctx;
                    const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
                    const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2 + 20;
                    
                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Main value
                    ctx.font = 'bold 28px Inter, sans-serif';
                    ctx.fillStyle = colorHex;
                    ctx.fillText(displayText, centerX, centerY - 10);
                    
                    // Label
                    ctx.font = '12px Inter, sans-serif';
                    ctx.fillStyle = '#9ca3af';
                    ctx.fillText('总计时长', centerX, centerY + 20);
                    
                    ctx.restore();
                }
            }]
        });
    }

    // 6. Daily Duration Bar Chart
    const ctxDailyDuration = document.getElementById('dailyDurationChart');
    if (ctxDailyDuration && stats.dailyDuration) {
        // Generate all dates from first to last using ISO format, fall back to dailyDuration keys
        let durationFirstDateStr = range?.start || stats.overview.firstDateISO;
        if (!durationFirstDateStr && stats.dailyDuration) {
            const sortedDates = Object.keys(stats.dailyDuration).sort();
            if (sortedDates.length > 0) durationFirstDateStr = sortedDates[0];
        }
        let durationLastDateStr = range?.end || stats.overview.lastDateISO;
        if (!durationLastDateStr && stats.dailyDuration) {
            const sortedDates = Object.keys(stats.dailyDuration).sort();
            if (sortedDates.length > 0) durationLastDateStr = sortedDates[sortedDates.length - 1];
        }
        const firstDateObj = durationFirstDateStr ? parseLocalDateKey(durationFirstDateStr) : null;
        const endDate = durationLastDateStr ? parseLocalDateKey(durationLastDateStr) : null;
        
        if (firstDateObj && endDate && !isNaN(firstDateObj.getTime()) && !isNaN(endDate.getTime())) {
            const dates = [];
            let currentDate = new Date(firstDateObj);
            
            let safety = 0;
            while (currentDate <= endDate && safety < 10000) {
                dates.push(formatLocalDateKey(currentDate));
                currentDate.setDate(currentDate.getDate() + 1);
                safety++;
            }

            const durationData = dates.map(date => stats.dailyDuration[date] || 0);

            charts.dailyDuration = new Chart(ctxDailyDuration, {
                type: 'bar',
                data: {
                    labels: dates,
                    datasets: [{
                        label: '每日时长(分钟)',
                        data: durationData,
                        backgroundColor: `rgba(${colorRGB}, 0.6)`,
                        borderColor: `rgba(${colorRGB}, 1)`,
                        borderWidth: 1,
                        borderRadius: 2,
                        maxBarThickness: 50
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => items[0].label,
                                label: (item) => {
                                    const mins = item.raw;
                                    if (mins >= 60) {
                                        return `${Math.floor(mins / 60)}小时 ${mins % 60}分钟`;
                                    }
                                    return `${mins}分钟`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: '#9ca3af',
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 15
                            }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#9ca3af',
                                callback: (value) => {
                                    if (value >= 60) return `${Math.floor(value / 60)}h`;
                                    return `${value}m`;
                                }
                            },
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    }
}


/**
 * Generate full statistics dashboard HTML
 */
export function generateDashboardHTML(stats, character, isGlobalMode = false, themeKey = 'violet') {
    const title = isGlobalMode ? '全部角色统计' : character.name;
    const safeTitle = escapeHtml(title);
    const dateRange = stats.__meta?.dateRange || null;
    const dateBounds = stats.__meta?.dateBounds || null;
    const startValue = dateRange?.start || dateBounds?.min || '';
    const endValue = dateRange?.end || dateBounds?.max || '';
    const minValue = dateBounds?.min || '';
    const maxValue = dateBounds?.max || '';
    const rangeDisplay = stats.overview.firstDate !== 'N/A'
        ? `${stats.overview.firstDate} - ${stats.overview.lastDate}`
        : (startValue || endValue ? `${startValue || 'N/A'} - ${endValue || 'N/A'}` : 'N/A');

    const theme = THEMES[themeKey] || THEMES.violet;
    const themeClass = theme.class;
    const themeColor = theme.color;
    // Map theme to icon
    const themeIcon = {
        'violet': 'fa-droplet',
        'blue': 'fa-water',
        'emerald': 'fa-leaf',
        'amber': 'fa-sun',
        'rose': 'fa-fire'
    }[themeKey] || 'fa-palette';

    return `
        <div class="stats-dashboard ${themeClass}">
            <div class="stats-header-row">
                <div class="stats-title-group">
                    <h3><i class="fa-solid fa-chart-simple"></i> 统计报告: ${safeTitle}</h3>
                    <small>${escapeHtml(rangeDisplay)}</small>
                </div>

                <div class="stats-date-range">
                    <span class="date-range-label">时间范围</span>
                    <input type="date" class="stats-date-input start-date" value="${startValue}" min="${minValue}" max="${maxValue}" />
                    <span class="date-range-sep">—</span>
                    <input type="date" class="stats-date-input end-date" value="${endValue}" min="${minValue}" max="${maxValue}" />
                    <button class="stats-date-apply">应用</button>
                </div>
                
                <div class="stats-actions">
                    <div class="stats-btn theme-btn" title="切换配色 (Change Theme: ${theme.name})" data-theme="${themeKey}">
                        <i class="fa-solid ${themeIcon}"></i>
                    </div>
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
            </div>
            
            <!-- Key Metrics Grid: 2 rows x 4 columns -->
            <div class="stats-metrics-row" style="grid-template-columns: repeat(4, 1fr);">
                <!-- Row 1: User Stats -->
                <div class="stats-card metric-item stat-user">
                    <span class="metric-value">${formatNumber(stats.overview.userMessages)}</span>
                    <span class="metric-label">用户消息数</span>
                </div>
                <div class="stats-card metric-item stat-user">
                    <span class="metric-value">${formatNumber(stats.overview.userCharCount)}</span>
                    <span class="metric-label">用户输入字数</span>
                </div>
                <div class="stats-card metric-item stat-user">
                    <span class="metric-value">${formatNumber(stats.tokens.user)}</span>
                    <span class="metric-label">用户输入 Token</span>
                </div>
                <div class="stats-card metric-item stat-card-user stat-user">
                    <span class="metric-value" style="font-size: 2.4em;">${formatNumber(stats.overview.totalMessages)}</span>
                    <span class="metric-label" style="opacity: 0.8; color: inherit;">总消息数</span>
                </div>

                <!-- Row 2: AI Stats -->
                <div class="stats-card metric-item stat-ai">
                    <span class="metric-value">${formatNumber(stats.overview.aiMessages)}</span>
                    <span class="metric-label">AI 消息数</span>
                </div>
                <div class="stats-card metric-item stat-ai">
                    <span class="metric-value">${formatNumber(stats.overview.aiCharCount)}</span>
                    <span class="metric-label">AI 输出字数</span>
                </div>
                <div class="stats-card metric-item stat-ai">
                    <span class="metric-value">${formatNumber(stats.tokens.ai)}</span>
                    <span class="metric-label">AI 输出 Token</span>
                </div>
                <div class="stats-card metric-item stat-card-ai stat-ai">
                    <span class="metric-value" style="font-size: 2.4em;">${stats.overview.ratio}x</span>
                    <span class="metric-label" style="opacity: 0.8; color: inherit;">AI/用户比</span>
                </div>
            </div>

            <!-- Timeline Chart (Years Vertical Bar Chart) -->
             <div class="stats-card" style="grid-column: span 3; min-height: 400px;">
                <div class="card-header-row">
                    <h4><i class="fa-solid fa-chart-column"></i> 每日活跃度统计 (从开始至今)</h4>
                    <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                </div>
                <div class="card-content" style="height: 320px; position: relative;">
                    <canvas id="timelineChart"></canvas>
                </div>
            </div>

            <!-- Duration Stats -->
            <div style="display: grid; grid-template-columns: 300px 1fr; gap: 20px;">
                <!-- Total Duration Gauge -->
                <div class="stats-card">
                    <div class="card-header-row">
                        <h4><i class="fa-solid fa-hourglass-half"></i> 总时长</h4>
                        <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                    </div>
                    <div class="card-content" style="display: flex; justify-content: center; align-items: center; height: 260px; position: relative;">
                        <canvas id="durationGaugeChart"></canvas>
                    </div>
                </div>
                
                <!-- Daily Duration Bar Chart -->
                <div class="stats-card">
                    <div class="card-header-row">
                        <h4><i class="fa-solid fa-clock-rotate-left"></i> 每日时长统计 (从开始至今)</h4>
                        <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                    </div>
                    <div class="card-content" style="height: 260px; position: relative;">
                        <canvas id="dailyDurationChart"></canvas>
                    </div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <!-- Hourly Heatmap -->
                <div class="stats-card">
                    <div class="card-header-row">
                        <h4><i class="fa-solid fa-clock"></i> 24小时分布</h4>
                        <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                    </div>
                    <div class="card-content">
                         <div style="margin-bottom: 10px; font-size: 0.9em; color: var(--st-text-muted);">
                            基于全时段的消息密度热力图与趋势统计
                        </div>
                        ${generateHourlyHeatmapHTML(stats.hourlyActivity, themeColor)}
                        <div style="height: 200px; margin-top: 20px; position: relative;">
                            <canvas id="hourlyChart"></canvas>
                        </div>
                    </div>
                </div>

                <!-- Model Stats Pie Chart -->
                <div class="stats-card">
                    <div class="card-header-row">
                        <h4><i class="fa-solid fa-pie-chart"></i> 模型偏好</h4>
                        <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                    </div>
                    <div class="card-content" style="height: 250px; position: relative;">
                        <canvas id="modelPieChart"></canvas>
                    </div>
                </div>
            </div>

            ${isGlobalMode ? `
            <!-- Character Ranking (Global Mode Only) -->
            <div class="stats-card" style="margin-top: 20px;">
                <div class="card-header-row">
                    <h4><i class="fa-solid fa-ranking-star"></i> 角色消息排行</h4>
                    <i class="fa-solid fa-chevron-up card-toggle-btn"></i>
                </div>
                <div class="card-content" style="height: 400px; position: relative;">
                    <canvas id="characterRankingChart"></canvas>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}


/**
 * Show overlay with content
 */
export function showOverlay(content, themeKey = 'violet') {
    $('#stats-overlay').remove();
    
    const theme = THEMES[themeKey] || THEMES.violet;
    const themeClass = theme.class;

    const overlay = $(`
        <div id="stats-overlay" class="${themeClass}">
            <div id="stats-content-wrapper" style="width: 100%; display: flex; justify-content: center;">
                ${content}
            </div>
        </div>
    `);
    
    $('body').append(overlay);
    
    return overlay;
}

/**
 * Close overlay
 */
export function closeOverlay() {
    $('#stats-overlay').fadeOut(200, function() {
        $(this).remove();
    });
}

/**
 * Setup event handlers for the dashboard
 */
export function setupDashboardEvents(refreshCallback) {
    const $overlay = $('#stats-overlay');
    const $wrapper = $('#stats-content-wrapper');
    // Auto-scroll heatmap to the right
    setTimeout(() => {
        const wrapper = $overlay.find('.heatmap-scroll-wrapper');
        if (wrapper.length) {
            const scrollWidth = wrapper[0].scrollWidth;
            wrapper.animate({ scrollLeft: scrollWidth }, 500);
        }
    }, 300);

    // Toggle card content - use event delegation
    $wrapper.off('click', '.card-toggle-btn').on('click', '.card-toggle-btn', function() {
        const btn = $(this);
        const content = btn.closest('.stats-card').find('.card-content');
        
        if (btn.hasClass('fa-chevron-up')) {
            btn.removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            btn.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }
        content.slideToggle(200);
    });

    const getCurrentDateRange = () => {
        const start = $overlay.find('.stats-date-input.start-date').val();
        const end = $overlay.find('.stats-date-input.end-date').val();
        return { start: start || '', end: end || '' };
    };

    // Apply date range
    $wrapper.off('click', '.stats-date-apply').on('click', '.stats-date-apply', function() {
        const range = getCurrentDateRange();
        if (range.start && range.end && range.start > range.end) {
            toastr.error('开始日期不能晚于结束日期。');
            return;
        }
        if (refreshCallback) {
            refreshCallback(true, range);
        }
    });

    // Refresh button
    $overlay.off('click', '.refresh-btn').on('click', '.refresh-btn', function() {
        const range = getCurrentDateRange();
        if (refreshCallback) {
            refreshCallback(true, range);
        }
    });

    // Download button
    $overlay.off('click', '.download-btn').on('click', '.download-btn', async function() {
        const dashboard = document.querySelector('.stats-dashboard');
        if (!dashboard) return;

        const btn = $(this);
        const originalHTML = btn.html();
        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

        // Hide action buttons temporarily
        const actions = dashboard.querySelector('.stats-actions');
        if (actions) {
            actions.style.display = 'none';
        }

        try {
            dashboard.classList.add('export-mode');
            const canvas = await html2canvas(dashboard, {
                backgroundColor: '#1f2023',
                scale: 2,
                useCORS: true,
                logging: false
            });

            const link = document.createElement('a');
            link.download = `SillyTavern_Stats_${formatLocalDateKey(new Date())}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            toastr.success('图片已导出！');
        } catch (error) {
            console.error(error);
            toastr.error('导出图片失败。');
        } finally {
            dashboard.classList.remove('export-mode');
            btn.html(originalHTML);
            if (actions) {
                actions.style.display = 'flex';
            }
        }
    });

    // Close button
    $overlay.off('click', '.close-btn').on('click', '.close-btn', closeOverlay);

    // Theme Switcher Button
    $overlay.off('click', '.theme-btn').on('click', '.theme-btn', function() {
        const btn = $(this);
        const currentTheme = btn.data('theme') || 'violet';
        const currentIndex = THEME_ORDER.indexOf(currentTheme);
        const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
        const nextTheme = THEME_ORDER[nextIndex];
        
        if (refreshCallback) {
            // Pass the new theme to the callback
            // (force=false, range=null, newTheme=nextTheme)
            refreshCallback(false, null, nextTheme);
        }
    });

    // Click outside to close - must be last and use specific target check
    $overlay.off('click', '.stats-overlay-backdrop').on('click', function(e) {
        // Only close if clicking directly on overlay background, not on dashboard content
        if ($(e.target).closest('.stats-dashboard').length === 0) {
            closeOverlay();
        }
    });
}
