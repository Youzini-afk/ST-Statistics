/**
 * API calls to SillyTavern backend
 */
import { Logger } from './logger.js';

const logger = new Logger('Stats-API');

function normalizeChatList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.chats)) return payload.chats;
    return [];
}

function normalizeMessages(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.messages)) return payload.messages;
    return [];
}

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

        const chatListPayload = await searchResponse.json();
        const chatList = normalizeChatList(chatListPayload);
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
                        const messagesPayload = await response.json();
                        const messages = normalizeMessages(messagesPayload);
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
            throw error;
        }
        logger.error('Fatal error in fetchAllChats:', error);
        throw error;
    }
}

/**
 * Fetch all chat files for all characters
 */
export async function fetchAllCharactersChats(onProgress, abortSignal) {
    const context = globalThis.SillyTavern.getContext();
    const characters = context.characters;
    
    if (!characters || characters.length === 0) {
        logger.warn('No characters found.');
        return [];
    }

    logger.log(`Fetching chats for ${characters.length} characters.`);
    
    const allChats = [];
    let processedChars = 0;
    let totalChatsFound = 0;

    for (const character of characters) {
        if (abortSignal?.aborted) {
            throw new Error('Operation cancelled');
        }

        const avatarUrl = character.avatar;
        if (!avatarUrl) continue;

        try {
            // Search for chats of this character
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
                processedChars++;
                continue;
            }

            const chatListPayload = await searchResponse.json();
            const chatList = normalizeChatList(chatListPayload);
            
            // Fetch chat contents
            for (const chatMeta of chatList) {
                if (abortSignal?.aborted) {
                    throw new Error('Operation cancelled');
                }

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
                        const messagesPayload = await response.json();
                        const messages = normalizeMessages(messagesPayload);
                        allChats.push({
                            metadata: { ...chatMeta, character_name: character.name },
                            messages: messages
                        });
                        totalChatsFound++;
                    }
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    // Continue on individual chat errors
                }
            }

        } catch (error) {
            if (error.name === 'AbortError' || error.message === 'Operation cancelled') {
                throw error;
            }
            logger.warn(`Error fetching chats for ${character.name}:`, error);
        }

        processedChars++;
        
        if (onProgress) {
            onProgress(processedChars, characters.length, totalChatsFound);
        }
    }

    logger.log(`Total chats found across all characters: ${allChats.length}`);
    return allChats;
}
