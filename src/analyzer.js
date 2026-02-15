/**
 * Chat data analysis functions
 */

/**
 * Parse send_date to Date object
 */
export function parseDate(dateString) {
    if (!dateString) return null;

    // Try standard Date parsing
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) return date;

    // Try timestamp
    if (/^\d+$/.test(String(dateString))) {
        let ts = Number(dateString);
        // Support second-based timestamps (10 digits) and millisecond-based timestamps.
        if (ts > 0 && ts < 1e12) {
            ts *= 1000;
        }
        date = new Date(ts);
        if (!isNaN(date.getTime())) return date;
    }

    // Try SillyTavern legacy format: "YYYY-M-D @HHh MMm SSs SSSms"
    const stMatch = String(dateString).match(
        /(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m(?:\s*(\d{1,2})s)?(?:\s*(\d{1,3})ms)?/i
    );
    if (stMatch) {
        const year = Number(stMatch[1]);
        const month = Number(stMatch[2]) - 1;
        const day = Number(stMatch[3]);
        const hour = Number(stMatch[4]);
        const minute = Number(stMatch[5]);
        const second = Number(stMatch[6] || 0);
        const ms = Number(stMatch[7] || 0);
        date = new Date(year, month, day, hour, minute, second, ms);
        if (!isNaN(date.getTime())) return date;
    }

    // Try common local format: "YYYY-MM-DD HH:mm[:ss]"
    const localMatch = String(dateString).match(
        /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );
    if (localMatch) {
        const year = Number(localMatch[1]);
        const month = Number(localMatch[2]) - 1;
        const day = Number(localMatch[3]);
        const hour = Number(localMatch[4]);
        const minute = Number(localMatch[5]);
        const second = Number(localMatch[6] || 0);
        date = new Date(year, month, day, hour, minute, second, 0);
        if (!isNaN(date.getTime())) return date;
    }

    // Try "Month DD, YYYY HH:MM am/pm" format
    const match = String(dateString).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (match) {
        const months = {
            'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
            'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5, 'jul': 6,
            'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        
        const monthName = match[1].toLowerCase();
        const day = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        let hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        const ampm = match[6].toLowerCase();

        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;

        const month = months[monthName];
        if (month !== undefined) {
            date = new Date(year, month, day, hour, minute);
            if (!isNaN(date.getTime())) return date;
        }
    }

    return null;
}

export function formatLocalDateKey(date) {
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
 * Estimate token count from text
 * Uses different ratios for CJK (Chinese, Japanese, Korean) vs Latin text
 * CJK: ~1.5 chars per token, Latin: ~3.5 chars per token
 */
function estimateTokenCount(text) {
    if (!text) return 0;
    
    // Count CJK characters (Chinese, Japanese, Korean)
    const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
    const cjkMatches = text.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkCount = text.length - cjkCount;
    
    // CJK: ~1.5 chars/token, Latin/Other: ~3.5 chars/token
    const cjkTokens = Math.ceil(cjkCount / 1.5);
    const nonCjkTokens = Math.ceil(nonCjkCount / 3.5);
    
    return cjkTokens + nonCjkTokens;
}

/**
 * Analyze all chat data and generate statistics
 */
export function analyzeChats(chatsData, options = {}) {
    const { startDate, endDate } = options;
    const start = startDate ? parseLocalDateKey(startDate) : null;
    const end = endDate ? parseLocalDateKey(endDate) : null;
    if (end) {
        end.setHours(23, 59, 59, 999);
    }
    const hasRange = !!(start || end);

    let totalMessages = 0;
    let userMessages = 0;
    let aiMessages = 0;
    let userCharCount = 0;
    let aiCharCount = 0;
    let aiTokens = 0;
    let maxMessagesInOneChat = 0;

    let firstDate = null;
    let lastDate = null;

    const modelUsage = {};
    const dailyActivity = {};
    const dailyFileCounts = {};
    const hourlyActivity = new Array(24).fill(0);
    const characterStats = {}; // 角色消息统计
    const dailyDuration = {}; // 每日时长统计 (分钟)

    let totalChats = 0;

    chatsData.forEach(chat => {
        const fileName = chat.metadata.file_name;
        const characterName = chat.metadata.character_name || '未知角色';
        let messageCountInRange = 0;

        chat.messages.forEach(msg => {
            const date = parseDate(msg.send_date);
            const inRange = !hasRange || (date && (!start || date >= start) && (!end || date <= end));
            if (!inRange) return;

            messageCountInRange++;
            totalMessages++;

            if (date) {
                if (!firstDate || date < firstDate) firstDate = date;
                if (!lastDate || date > lastDate) lastDate = date;

                const dateKey = formatLocalDateKey(date);
                dailyActivity[dateKey] = (dailyActivity[dateKey] || 0) + 1;

                if (!dailyFileCounts[dateKey]) {
                    dailyFileCounts[dateKey] = new Set();
                }
                dailyFileCounts[dateKey].add(fileName);

                const hour = date.getHours();
                if (hour >= 0 && hour < 24) {
                    hourlyActivity[hour]++;
                }
            }

            const text = msg.mes || '';
            
            if (msg.is_user) {
                userMessages++;
                userCharCount += text.length;
            } else {
                aiMessages++;
                aiCharCount += text.length;
                const tokenCountRaw = msg.extra?.token_count;
                const tokenCount = Number(tokenCountRaw);
                if (Number.isFinite(tokenCount) && tokenCount >= 0) {
                    aiTokens += tokenCount;
                } else {
                    // Fallback estimation for AI messages without token_count
                    aiTokens += estimateTokenCount(text);
                }
                
                if (msg.extra && msg.extra.model) {
                    const model = msg.extra.model;
                    modelUsage[model] = (modelUsage[model] || 0) + 1;
                }
            }
        });

        if (messageCountInRange > 0) {
            totalChats++;
            characterStats[characterName] = (characterStats[characterName] || 0) + messageCountInRange;

            if (messageCountInRange > maxMessagesInOneChat) {
                maxMessagesInOneChat = messageCountInRange;
            }
        }
    });

    // Calculate daily duration using interaction-based estimation
    // - User messages: estimate typing time (60 chars/min for CJK, 200 chars/min for Latin)
    // - AI messages: estimate reading time (400 chars/min for CJK, 800 chars/min for Latin)
    // - Session gap > 30 min = new session, don't add gap time
    // - Minimum 1 min per session
    const SESSION_GAP_MS = 30 * 60 * 1000;
    
    // Helper to estimate interaction time for a message
    const estimateInteractionTime = (text, isUser) => {
        if (!text) return 0.5; // minimum 30 seconds for empty
        
        const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
        const cjkMatches = text.match(cjkRegex);
        const cjkCount = cjkMatches ? cjkMatches.length : 0;
        const nonCjkCount = text.length - cjkCount;
        
        if (isUser) {
            // Typing speed: 60 CJK chars/min, 200 Latin chars/min
            const cjkMins = cjkCount / 60;
            const latinMins = nonCjkCount / 200;
            return Math.max(0.25, cjkMins + latinMins); // min 15 seconds
        } else {
            // Reading speed: 400 CJK chars/min, 800 Latin chars/min
            const cjkMins = cjkCount / 400;
            const latinMins = nonCjkCount / 800;
            return Math.max(0.1, cjkMins + latinMins); // min 6 seconds
        }
    };
    
    // Collect messages with timestamps and text for duration calculation
    const dailyMessages = {};
    chatsData.forEach(chat => {
        chat.messages.forEach(msg => {
            const date = parseDate(msg.send_date);
            if (!date) return;
            
            const inRange = !hasRange || ((!start || date >= start) && (!end || date <= end));
            if (!inRange) return;
            
            const dateKey = formatLocalDateKey(date);
            if (!dailyMessages[dateKey]) {
                dailyMessages[dateKey] = [];
            }
            dailyMessages[dateKey].push({
                timestamp: date.getTime(),
                text: msg.mes || '',
                isUser: !!msg.is_user
            });
        });
    });
    
    for (const [dayKey, messages] of Object.entries(dailyMessages)) {
        if (!messages.length) continue;
        messages.sort((a, b) => a.timestamp - b.timestamp);
        
        let totalMinutes = 0;
        let sessionMinutes = 0;
        let prevTimestamp = messages[0].timestamp;
        
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const gap = msg.timestamp - prevTimestamp;
            
            // If gap > 30 min, start new session
            if (i > 0 && gap > SESSION_GAP_MS) {
                // Add previous session (min 1 minute per session)
                totalMinutes += Math.max(1, sessionMinutes);
                sessionMinutes = 0;
            }
            
            // Add interaction time for this message
            sessionMinutes += estimateInteractionTime(msg.text, msg.isUser);
            prevTimestamp = msg.timestamp;
        }
        
        // Add last session
        totalMinutes += Math.max(1, sessionMinutes);
        
        dailyDuration[dayKey] = Math.round(totalMinutes);
    }

    // Calculate user tokens: Chinese ~1.5 chars per token
    const userTokens = Math.ceil(userCharCount / 1.5);

    // Convert daily file counts from Sets to numbers
    let dailyFileCountsObj = {};
    for (const [date, fileSet] of Object.entries(dailyFileCounts)) {
        dailyFileCountsObj[date] = fileSet.size;
    }

    const avgMessagesPerChat = totalChats > 0 ? Math.round(totalMessages / totalChats) : 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const firstDay = firstDate ? new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate()) : null;
    const lastDay = lastDate ? new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate()) : null;
    const daysActive = firstDay && lastDay ? Math.floor((lastDay - firstDay) / dayMs) + 1 : 0;

    // Calculate total duration in minutes
    const totalDurationMinutes = Object.values(dailyDuration).reduce((sum, mins) => sum + mins, 0);

    return {
        overview: {
            totalMessages,
            userMessages,
            aiMessages,
            userCharCount,
            aiCharCount,
            avgMessagesPerChat,
            maxMessagesInOneChat,
            ratio: userMessages > 0 ? (aiMessages / userMessages).toFixed(2) : 0,
            firstDate: firstDate ? firstDate.toLocaleDateString() : 'N/A',
            lastDate: lastDate ? lastDate.toLocaleDateString() : 'N/A',
            firstDateISO: firstDate ? formatLocalDateKey(firstDate) : null,
            lastDateISO: lastDate ? formatLocalDateKey(lastDate) : null,
            daysActive,
            totalDurationMinutes
        },
        tokens: {
            ai: aiTokens,
            user: userTokens
        },
        models: modelUsage,
        dailyActivity,
        dailyFileCounts: dailyFileCountsObj,
        dailyDuration,
        hourlyActivity,
        characterStats
    };
}
