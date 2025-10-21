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
import { mainLogger } from './logger.js';

/**
 * Gets the recent chat history.
 * @param {number} [limit=20] - The maximum number of recent messages to retrieve.
 * @returns {Promise<string>} A promise that resolves to a formatted string of the chat history.
 */
async function getChatHistory(limit = 20) {
    try {
        const context = getContext();
        
        if (!context) {
            mainLogger.warn('[信息聚合] 无法获取上下文对象');
            return "无聊天上下文可用。";
        }
        
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            mainLogger.info('[信息聚合] 当前无聊天历史');
            return "暂无聊天历史。";
        }

        const recentChat = chat.slice(-limit);
        return recentChat.map(msg => {
            const author = msg.is_user ? (context.name1 || '用户') : (msg.name || '角色');
            return `${author}: ${msg.mes || msg.message || ''}`;
        }).join('\n');
        
    } catch (error) {
        mainLogger.error('[信息聚合] 获取聊天历史失败', error.message);
        return "获取聊天历史时出错。";
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
            mainLogger.info('[信息聚合] 未选择角色');
            return "未选择角色。\n";
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
            mainLogger.info('[信息聚合] 当前角色未链接世界书');
            return "当前角色未链接世界书。\n";
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
                mainLogger.error(`[信息聚合] 读取世界书失败 ${bookName}`, error.message);
            }
        }
        
        return allEntriesContent;
    } catch (error) {
        mainLogger.error("[信息聚合] 获取活跃世界书失败", error.message);
        return "获取世界书信息时出错。";
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
        
        let charInfo = "### 主要角色\n\n";

        if (mainChar) {
            charInfo += `#### ${mainChar.name}\n`;
            charInfo += `描述: ${mainChar.description}\n`;
            charInfo += `性格: ${mainChar.personality}\n`;
            charInfo += `首条消息: ${mainChar.first_mes}\n\n`;
        }

        // 可以在这里添加获取其他角色的逻辑
        // 目前专注于主要角色

        return charInfo;
    } catch (error) {
        mainLogger.error("[信息聚合] 获取角色卡失败", error.message);
        return "获取角色信息时出错。";
    }
}

/**
 * 从 st-memory-enhancement 插件读取表格数据
 * @returns {string} 格式化后的表格文本
 */
function getTableData() {
    try {
        if (window.stMemoryEnhancement && 
            typeof window.stMemoryEnhancement.ext_exportAllTablesAsJson === 'function') {
            const tableJson = window.stMemoryEnhancement.ext_exportAllTablesAsJson();
            return formatTableDataForLLM(tableJson);
        } else {
            mainLogger.info('[信息聚合] 未检测到记忆增强插件或版本不兼容');
            return '未检测到记忆增强插件或版本不兼容。';
        }
    } catch (error) {
        mainLogger.error(`[信息聚合] 读取表格数据失败: ${error.message}`);
        return '读取表格数据时发生错误。';
    }
}

/**
 * 格式化表格数据为LLM可读文本
 * @param {object} jsonData - ext_exportAllTablesAsJson 返回的JSON对象
 * @returns {string} 格式化后的文本
 */
function formatTableDataForLLM(jsonData) {
    if (!jsonData || typeof jsonData !== 'object' || Object.keys(jsonData).length === 0) {
        return '当前无任何可用的表格数据。';
    }

    let output = '以下是角色记忆表格数据：\n\n';

    for (const sheetId in jsonData) {
        if (Object.prototype.hasOwnProperty.call(jsonData, sheetId)) {
            const sheet = jsonData[sheetId];
            // 确保表格有名称，且内容至少包含表头和一行数据
            if (sheet && sheet.name && sheet.content && sheet.content.length > 1) {
                output += `## 表格: ${sheet.name}\n`;
                const headers = sheet.content[0].slice(1); // 第一行是表头，第一个元素通常为空
                const rows = sheet.content.slice(1);

                rows.forEach((row, rowIndex) => {
                    const rowData = row.slice(1);
                    let rowOutput = '';
                    let hasContent = false;
                    
                    headers.forEach((header, index) => {
                        const cellValue = rowData[index];
                        if (cellValue !== null && cellValue !== undefined && String(cellValue).trim() !== '') {
                            rowOutput += `  - ${header}: ${cellValue}\n`;
                            hasContent = true;
                        }
                    });

                    if (hasContent) {
                        output += `\n### 记录 ${rowIndex + 1}\n${rowOutput}`;
                    }
                });
            }
        }
    }
    
    output += '\n--- 表格数据结束 ---\n';
    return output;
}

/**
 * Reads and parses the content of tables.
 * This is an approximation as there's no direct API.
 * It looks for chat messages that might contain rendered table data.
 * @returns {Promise<string>} A promise that resolves to a string containing table data.
 */
async function getTables(messageLimit = 50) {
    try {
        const context = getContext();
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            return "";
        }

        let tableContent = "### 表格数据\n\n";
        let foundTables = false;

        // 只处理最近的N条消息以提高性能
        const recentMessages = chat.slice(-messageLimit);
        const tableMarkers = ['<div class="amily2-table-wrapper">', 'class="grid-table"'];

        for (const msg of recentMessages) {
            // 先用字符串检查，避免不必要的DOM操作
            const hasTable = tableMarkers.some(marker => 
                msg.message && msg.message.includes(marker)
            );
            
            if (hasTable) {
                tableContent += `在${msg.name}的消息中发现表格数据。\n`;
                
                // 使用DOMParser代替createElement，更安全
                const parser = new DOMParser();
                const doc = parser.parseFromString(msg.message, 'text/html');
                const textContent = doc.body.textContent || doc.body.innerText || "";
                
                // 限制内容长度
                tableContent += textContent.substring(0, 1000);
                tableContent += "\n\n";
                foundTables = true;
            }
        }

        if (!foundTables) {
            return "近期聊天中未发现表格数据。\n\n";
        }

        return tableContent;
    } catch (error) {
        mainLogger.error("[信息聚合] 获取表格数据失败", error.message);
        return "获取表格信息时出错。\n\n";
    }
}

/**
 * Aggregates all context into a single string for the AI to analyze.
 * @returns {Promise<string>} A promise that resolves to the complete world state as a string.
 */
export async function getAllContext() {
    let fullContext = "### 当前世界状态分析\n\n";

    // 并行获取所有信息以提高性能
    const [charCards, lorebooks, tables, chatHistory] = await Promise.all([
        getCharacterCards(),
        getActiveLorebooks(),
        getTables(),
        getChatHistory()
    ]);

    fullContext += charCards;
    fullContext += lorebooks;
    fullContext += tables;
    
    // 添加来自记忆增强插件的表格数据（优先级更高）
    const memoryTableData = getTableData();
    if (memoryTableData && !memoryTableData.includes('未检测到') && !memoryTableData.includes('错误')) {
        fullContext += "### 记忆增强表格数据\n\n" + memoryTableData + "\n\n";
    }
    
    fullContext += "### 近期对话\n\n" + chatHistory;

    return fullContext;
}

/**
 * 导出表格数据读取函数供其他模块使用
 * @returns {string} 格式化后的表格文本
 */
export function getMemoryTableData() {
    return getTableData();
}
