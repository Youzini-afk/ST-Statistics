/**
 * API calls to SillyTavern backend
 */
import { Logger } from './logger.js';

const logger = new Logger('Stats-API');

/**
 * Count tokens for given text using SillyTavern's tokenizer API
 * @param {string} text - Text to tokenize
 * @returns {Promise<number>} Token count
 */
export async function countTokens(text) {
    if (!text) return 0;
    
    const context = globalThis.SillyTavern.getContext();
    
    try {
        // Try to use the tokenizer API
        const response = await fetch('/api/tokenizers/openai/encode?model=gpt-4', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ text: text })
        });
        
        if (response.ok) {
            const result = await response.json();
            return result.count || result.ids?.length || 0;
        }
    } catch (error) {
        logger.warn('Tokenizer API failed, using estimation:', error);
    }
    
    // Fallback: estimate tokens
    // CJK: ~1.5 chars/token, Latin: ~3.5 chars/token
    const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
    const cjkMatches = text.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkCount = text.length - cjkCount;
    
    return Math.ceil(cjkCount / 1.5) + Math.ceil(nonCjkCount / 3.5);
}

/**
 * Fetch all chat files for a character
 */
export async function fetchAllChats(avatarUrl, onProgress, abortSignal) {
    logger.log(`Fetching chat list for: ${avatarUrl}`);
    
    const context = globalThis.SillyTavern.getContext();
    
    try {
        // Search for all chats
        const searchResponse = await fetch('/api/chats/search', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatarUrl,
                query: ''
            }),
            signal: abortSignal
        });

        if (!searchResponse.ok) {
            throw new Error(`Failed to search chats: ${searchResponse.status}`);
        }

        const chatList = await searchResponse.json();
        const totalFiles = chatList.length;
        logger.log(`Found ${totalFiles} chat files.`);

        const allChats = [];
        const BATCH_SIZE = 50;
        let processed = 0;

        // Update initial progress
        if (onProgress) {
            onProgress(0, totalFiles);
        }

        // Fetch in batches
        for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
            if (abortSignal?.aborted) {
                throw new Error('Operation cancelled');
            }

            const batch = chatList.slice(i, i + BATCH_SIZE);
            
            const batchPromises = batch.map(async (chatMeta) => {
                const fileName = chatMeta.file_name.replace('.jsonl', '');
                
                try {
                    const response = await fetch('/api/chats/get', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({
                            avatar_url: avatarUrl,
                            file_name: fileName
                        }),
                        signal: abortSignal
                    });

                    if (response.ok) {
                        const messages = await response.json();
                        return {
                            metadata: chatMeta,
                            messages: messages
                        };
                    } else {
                        logger.warn(`Failed to fetch content for ${chatMeta.file_name}`);
                        return null;
                    }
                } catch (error) {
                    if (error.name === 'AbortError') {
                        throw error;
                    }
                    logger.error(`Error fetching ${chatMeta.file_name}:`, error);
                    return null;
                } finally {
                    processed++;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            allChats.push(...batchResults.filter(chat => chat !== null));

            // Update progress
            if (onProgress) {
                onProgress(processed, totalFiles);
            }
        }

        return allChats;
        
    } catch (error) {
        if (error.name === 'AbortError' || error.message === 'Operation cancelled') {
            logger.log('Fetch operation cancelled.');
            return [];
        }
        logger.error('Fatal error in fetchAllChats:', error);
        throw error;
    }
}
