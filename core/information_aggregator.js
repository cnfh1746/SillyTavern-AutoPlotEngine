/**
 * @file information_aggregator.js
 * @description
 * This module is responsible for silently collecting all necessary information 
 * from the SillyTavern environment, including chat history, active lorebooks, 
 * character cards, and tables. This aggregated information forms the complete 
 * "current world state" to be analyzed by the plot engine.
 */

import { getContext } from '/scripts/extensions.js';
import { characters } from '/script.js';
import { loadWorldInfo, world_names } from '/scripts/world-info.js';

/**
 * Gets the recent chat history.
 * @param {number} [limit=20] - The maximum number of recent messages to retrieve.
 * @returns {Promise<string>} A promise that resolves to a formatted string of the chat history.
 */
async function getChatHistory(limit = 20) {
    try {
        const context = getContext();
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            return "No chat history available.";
        }

        const recentChat = chat.slice(-limit);
        return recentChat.map(msg => {
            const author = msg.is_user ? (context.name1 || 'User') : (msg.name || 'Character');
            return `${author}: ${msg.mes || msg.message || ''}`;
        }).join('\n');
    } catch (error) {
        console.error("[AutoPlotEngine] Error getting chat history:", error);
        return "Error retrieving chat history.";
    }
}

/**
 * Check if TavernHelper is available
 */
function isTavernHelperAvailable() {
    return typeof window.TavernHelper !== 'undefined' && 
           window.TavernHelper !== null &&
           typeof window.TavernHelper.getLorebookEntries === 'function';
}

/**
 * Reads the content of all currently enabled lorebooks for the current character.
 * @returns {Promise<string>} A promise that resolves to a formatted string of all active lorebook entries.
 */
async function getActiveLorebooks() {
    try {
        const context = getContext();
        if (!context || !context.characterId) {
            return "No character selected.\n";
        }

        let allEntriesContent = "### Active Lorebooks\n\n";
        const character = characters[context.characterId];
        
        // Get character's world books
        const bookNames = [];
        
        // Try using TavernHelper if available
        if (isTavernHelperAvailable()) {
            try {
                const charLorebooks = await window.TavernHelper.getCharLorebooks({ type: 'all' });
                if (charLorebooks.primary) bookNames.push(charLorebooks.primary);
                if (charLorebooks.additional?.length) bookNames.push(...charLorebooks.additional);
            } catch (error) {
                console.warn("[AutoPlotEngine] TavernHelper failed, falling back to native API:", error);
            }
        }
        
        // Fallback: use character's main world book
        if (bookNames.length === 0 && character?.data?.extensions?.world) {
            bookNames.push(character.data.extensions.world);
        }

        if (bookNames.length === 0) {
            return "No lorebooks linked to current character.\n";
        }

        // Read entries from each book
        for (const bookName of bookNames) {
            if (!world_names.includes(bookName)) continue;

            try {
                let entries = [];
                
                // Try TavernHelper first
                if (isTavernHelperAvailable()) {
                    try {
                        entries = await window.TavernHelper.getLorebookEntries(bookName);
                    } catch (error) {
                        console.warn(`[AutoPlotEngine] TavernHelper failed for ${bookName}, using native API:`, error);
                    }
                }
                
                // Fallback to native API
                if (entries.length === 0) {
                    const bookData = await loadWorldInfo(bookName);
                    if (bookData && bookData.entries) {
                        entries = Object.values(bookData.entries)
                            .filter(entry => !entry.disable)
                            .map(entry => ({
                                enabled: !entry.disable,
                                keys: entry.key || [],
                                content: entry.content || ''
                            }));
                    }
                }

                if (entries.length === 0) continue;

                allEntriesContent += `#### Lorebook: ${bookName}\n\n`;

                for (const entry of entries) {
                    if (entry.enabled !== false) {
                        const keys = Array.isArray(entry.keys) ? entry.keys.join(', ') : 
                                    Array.isArray(entry.key) ? entry.key.join(', ') : '';
                        allEntriesContent += `**Entry: ${keys}**\n`;
                        allEntriesContent += `${entry.content}\n\n`;
                    }
                }
            } catch (error) {
                console.error(`[AutoPlotEngine] Error reading lorebook ${bookName}:`, error);
            }
        }
        
        return allEntriesContent;
    } catch (error) {
        console.error("[AutoPlotEngine] Error getting active lorebooks:", error);
        return "Error retrieving lorebook information.";
    }
}

/**
 * Gets the information of the main characters.
 * @returns {Promise<string>} A promise that resolves to a string containing character card information.
 */
async function getCharacterCards() {
    try {
        const context = getContext();
        const mainCharId = context.characterId;
        const mainChar = context.characters[mainCharId];
        
        let charInfo = "### Main Characters\n\n";

        if (mainChar) {
            charInfo += `#### ${mainChar.name}\n`;
            charInfo += `Description: ${mainChar.description}\n`;
            charInfo += `Personality: ${mainChar.personality}\n`;
            charInfo += `First Message: ${mainChar.first_mes}\n\n`;
        }

        // You could potentially add logic here to get other characters as well
        // For now, we focus on the primary character.

        return charInfo;
    } catch (error) {
        console.error("Error getting character cards:", error);
        return "Error retrieving character information.";
    }
}

/**
 * Reads and parses the content of tables.
 * This is an approximation as there's no direct API.
 * It looks for chat messages that might contain rendered table data.
 * @returns {Promise<string>} A promise that resolves to a string containing table data.
 */
async function getTables() {
    try {
        const context = getContext();
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            return "";
        }

        let tableContent = "### Tables Data\n\n";
        let foundTables = false;

        // Tables are often injected as complex HTML. We'll look for markers.
        // This is a heuristic approach.
        const tableMarkers = ['<div class="amily2-table-wrapper">', 'class="grid-table"'];

        for (const msg of chat) {
            if (tableMarkers.some(marker => msg.message.includes(marker))) {
                // We won't dump the raw HTML, but will indicate its presence.
                // A more sophisticated parser could be built if needed.
                tableContent += `Found table data in a message by ${msg.name}.\n`;
                // For now, we just extract the text content to avoid sending huge HTML blocks.
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = msg.message;
                tableContent += (tempDiv.textContent || tempDiv.innerText || "");
                tableContent += "\n\n";
                foundTables = true;
            }
        }

        if (!foundTables) {
            return "No table data found in recent chat.\n\n";
        }

        return tableContent;
    } catch (error) {
        console.error("Error getting tables data:", error);
        return "Error retrieving tables information.\n\n";
    }
}

/**
 * Aggregates all context into a single string for the AI to analyze.
 * @returns {Promise<string>} A promise that resolves to the complete world state as a string.
 */
export async function getAllContext() {
    let fullContext = "### Current World State Analysis\n\n";

    const charCards = await getCharacterCards();
    fullContext += charCards;

    const lorebooks = await getActiveLorebooks();
    fullContext += lorebooks;

    const tables = await getTables();
    fullContext += tables;

    const chatHistory = await getChatHistory();
    fullContext += "### Recent Conversation\n\n" + chatHistory;

    return fullContext;
}
