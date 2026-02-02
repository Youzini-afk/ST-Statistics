/**
 * UI rendering functions
 */
import html2canvas from 'html2canvas';
import { Logger } from './logger.js';
import Chart from 'chart.js/auto';

const logger = new Logger('Stats-UI');
let charts = {}; // Store chart instances to destroy them later

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
function generateHourlyHeatmapHTML(hourlyActivity) {
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
                 style="flex: 1; background-color: rgba(139, 92, 246, ${alpha}); position: relative; cursor: help;">
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
export function initCharts(stats) {
    cleanupCharts();

    // 1. Timeline Chart (Bar Chart for Daily Activity)
    const ctxTimeline = document.getElementById('timelineChart');
    if (ctxTimeline && stats.overview.firstDate && stats.overview.firstDate !== 'N/A') {
        const firstDateObj = new Date(stats.overview.firstDate);
        if (!isNaN(firstDateObj.getTime())) {
            const dates = [];
            let currentDate = firstDateObj;
            const endDate = new Date(); // Today
        
        let safety = 0;
        while (currentDate <= endDate && safety < 10000) {
            dates.push(currentDate.toISOString().split('T')[0]);
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
                        backgroundColor: 'rgba(139, 92, 246, 0.6)',
                        borderColor: 'rgba(139, 92, 246, 1)',
                        borderWidth: 1,
                        barPercentage: 0.8,
                        categoryPercentage: 0.9,
                        borderRadius: 2
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
                    borderColor: 'rgba(139, 92, 246, 1)',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(139, 92, 246, 1)',
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

        charts.model = new Chart(ctxModel, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(236, 72, 153, 0.8)',
                        'rgba(99, 102, 241, 0.8)',
                        'rgba(20, 184, 166, 0.8)',
                        'rgba(217, 70, 239, 0.8)',
                        'rgba(249, 115, 22, 0.8)'
                    ],
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
                    backgroundColor: 'rgba(139, 92, 246, 0.7)',
                    borderColor: 'rgba(139, 92, 246, 1)',
                    borderWidth: 1,
                    borderRadius: 4
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
}


/**
 * Generate full statistics dashboard HTML
 */
export function generateDashboardHTML(stats, character, isGlobalMode = false) {
    const title = isGlobalMode ? '全部角色统计' : character.name;
    const dateRange = stats.__meta?.dateRange || null;
    const dateBounds = stats.__meta?.dateBounds || null;
    const startValue = dateRange?.start || dateBounds?.min || '';
    const endValue = dateRange?.end || dateBounds?.max || '';
    const minValue = dateBounds?.min || '';
    const maxValue = dateBounds?.max || '';
    const rangeDisplay = stats.overview.firstDate !== 'N/A'
        ? `${stats.overview.firstDate} - ${stats.overview.lastDate}`
        : (startValue || endValue ? `${startValue || 'N/A'} - ${endValue || 'N/A'}` : 'N/A');
    return `
        <div class="stats-dashboard">
            <div class="stats-header-row">
                <div class="stats-title-group">
                    <h3><i class="fa-solid fa-chart-simple"></i> 统计报告: ${title}</h3>
                    <small>${rangeDisplay}</small>
                </div>

                <div class="stats-date-range">
                    <span class="date-range-label">时间范围</span>
                    <input type="date" class="stats-date-input start-date" value="${startValue}" min="${minValue}" max="${maxValue}" />
                    <span class="date-range-sep">—</span>
                    <input type="date" class="stats-date-input end-date" value="${endValue}" min="${minValue}" max="${maxValue}" />
                    <button class="stats-date-apply">应用</button>
                </div>
                
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
            </div>
            
            <!-- Key Metrics Grid: 2 rows x 4 columns -->
            <div class="stats-metrics-row" style="grid-template-columns: repeat(4, 1fr);">
                <!-- Row 1: User Stats -->
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #60a5fa;">${formatNumber(stats.overview.userMessages)}</span>
                    <span class="metric-label">用户消息数</span>
                </div>
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #60a5fa;">${formatNumber(stats.overview.userCharCount)}</span>
                    <span class="metric-label">用户输入字数</span>
                </div>
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #38bdf8;">${formatNumber(stats.tokens.user)}</span>
                    <span class="metric-label">用户输入 Token</span>
                </div>
                <div class="stats-card metric-item" style="background: rgba(96, 165, 250, 0.1); border-color: rgba(96, 165, 250, 0.3);">
                    <span class="metric-value" style="font-size: 2.4em; color: #93c5fd;">${formatNumber(stats.overview.totalMessages)}</span>
                    <span class="metric-label" style="color: #bfdbfe;">总消息数</span>
                </div>

                <!-- Row 2: AI Stats -->
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #c084fc;">${formatNumber(stats.overview.aiMessages)}</span>
                    <span class="metric-label">AI 消息数</span>
                </div>
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #c084fc;">${formatNumber(stats.overview.aiCharCount)}</span>
                    <span class="metric-label">AI 输出字数</span>
                </div>
                <div class="stats-card metric-item">
                    <span class="metric-value" style="color: #e879f9;">${formatNumber(stats.tokens.ai)}</span>
                    <span class="metric-label">AI 输出 Token</span>
                </div>
                <div class="stats-card metric-item" style="background: rgba(192, 132, 252, 0.1); border-color: rgba(192, 132, 252, 0.3);">
                    <span class="metric-value" style="font-size: 2.4em; color: #d8b4fe;">${stats.overview.ratio}x</span>
                    <span class="metric-label" style="color: #e9d5ff;">AI/用户比</span>
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
                        ${generateHourlyHeatmapHTML(stats.hourlyActivity)}
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
export function showOverlay(content) {
    $('#stats-overlay').remove();
    
    const overlay = $(`
        <div id="stats-overlay">
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
    // Auto-scroll heatmap to the right
    setTimeout(() => {
        const wrapper = $('.heatmap-scroll-wrapper');
        if (wrapper.length) {
            const scrollWidth = wrapper[0].scrollWidth;
            wrapper.animate({ scrollLeft: scrollWidth }, 500);
        }
    }, 300);

    // Toggle card content - use event delegation
    $('#stats-content-wrapper').off('click', '.card-toggle-btn').on('click', '.card-toggle-btn', function() {
        const btn = $(this);
        const content = btn.closest('.stats-card').find('.card-content');
        
        if (btn.hasClass('fa-chevron-up')) {
            btn.removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            btn.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }
        content.slideToggle(200);
    });

    // Heatmap cell interaction
    $('#stats-content-wrapper').off('click mouseenter', '.heatmap-cell').on('click mouseenter', '.heatmap-cell', function() {
        const date = $(this).data('date');
        const count = $(this).data('count');
        const files = $(this).data('files');
        
        $('.heatmap-cell').removeClass('active');
        $(this).addClass('active');
        
        $('#heatmap-detail-date').text(date);
        $('#heatmap-detail-msg').text(`${count} 消息`);
        $('#heatmap-detail-files').text(`${files} 文件`);
    });

    // Hourly cell interaction
    $('#stats-content-wrapper').off('click mouseenter', '.hourly-cell').on('click mouseenter', '.hourly-cell', function() {
        const hour = parseInt($(this).data('hour'));
        const count = $(this).data('count');
        
        $('.hourly-cell').css('border', 'none');
        $(this).css('border', '1px solid #fff');
        
        $('#hourly-detail-time').text(`${hour}:00 - ${hour}:59`);
        $('#hourly-detail-msg').text(`${count} 消息`);
    });

    const getCurrentDateRange = () => {
        const start = $('.stats-date-input.start-date').val();
        const end = $('.stats-date-input.end-date').val();
        return { start: start || '', end: end || '' };
    };

    // Apply date range
    $('#stats-content-wrapper').off('click', '.stats-date-apply').on('click', '.stats-date-apply', function() {
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
    $('.refresh-btn').off('click').on('click', function() {
        const range = getCurrentDateRange();
        if (refreshCallback) {
            refreshCallback(true, range);
        }
    });

    // Download button
    $('.download-btn').off('click').on('click', async function() {
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
            link.download = `SillyTavern_Stats_${new Date().toISOString().slice(0, 10)}.png`;
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
    $('.close-btn').off('click').on('click', closeOverlay);

    // Click outside to close
    $('#stats-overlay').off('click').on('click', function(e) {
        if (e.target === this || e.target.id === 'stats-content-wrapper') {
            closeOverlay();
        }
    });
}
