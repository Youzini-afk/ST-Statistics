/**
 * Chat data analysis functions
 */

/**
 * Parse send_date to Date object
 */
function parseDate(dateString) {
    if (!dateString) return null;

    // Try standard Date parsing
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) return date;

    // Try timestamp
    if (/^\d+$/.test(String(dateString))) {
        date = new Date(Number(dateString));
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
export function analyzeChats(chatsData) {
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

    const totalChats = chatsData.length;

    chatsData.forEach(chat => {
        const fileName = chat.metadata.file_name;
        const messageCount = chat.messages.length;

        if (messageCount > maxMessagesInOneChat) {
            maxMessagesInOneChat = messageCount;
        }

        chat.messages.forEach(msg => {
            totalMessages++;

            const date = parseDate(msg.send_date);
            if (date) {
                if (!firstDate || date < firstDate) firstDate = date;
                if (!lastDate || date > lastDate) lastDate = date;

                const dateKey = date.toISOString().split('T')[0];
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
                if (msg.extra && msg.extra.token_count) {
                    aiTokens += msg.extra.token_count;
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
    });

    // Calculate user tokens: Chinese ~1.5 chars per token
    const userTokens = Math.ceil(userCharCount / 1.5);

    // Convert daily file counts from Sets to numbers
    let dailyFileCountsObj = {};
    for (const [date, fileSet] of Object.entries(dailyFileCounts)) {
        dailyFileCountsObj[date] = fileSet.size;
    }

    const avgMessagesPerChat = totalChats > 0 ? Math.round(totalMessages / totalChats) : 0;

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
            daysActive: firstDate && lastDate ? Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)) : 0
        },
        tokens: {
            ai: aiTokens,
            user: userTokens
        },
        models: modelUsage,
        dailyActivity,
        dailyFileCounts: dailyFileCountsObj,
        hourlyActivity
    };
}
