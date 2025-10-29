/**
 * @file worldbook_manager.js
 * @description 世界书管理功能 - 智能删除世界书条目
 */

import { mainLogger } from './logger.js';
import { getSettings } from './settingsManager.js';
import { safeParseJSON, callAI, MAX_TOKENS } from './utils.js';
import { loadWorldInfo, saveWorldInfo } from "/scripts/world-info.js";

const { toastr, TavernHelper } = window;

/**
 * 使用AI分析用户指令并执行删除
 * @param {string} instruction - 用户指令（如："删除所有日志条目"、"删除长离和秧秧的条目"）
 * @returns {Promise<Object>} 删除结果统计
 */
export async function deleteWorldBookEntries(instruction) {
    mainLogger.info(`[世界书管理] ========== 开始处理删除指令 ==========`);
    mainLogger.info(`[世界书管理] 用户指令: ${instruction}`);
    
    try {
        const settings = getSettings();
        
        // 1. 加载当前角色的世界书
        if (!TavernHelper || typeof TavernHelper.getCurrentCharPrimaryLorebook !== 'function') {
            throw new Error("TavernHelper API 不可用");
        }
        
        const lorebookName = await TavernHelper.getCurrentCharPrimaryLorebook();
        
        if (!lorebookName) {
            throw new Error("当前角色没有绑定世界书");
        }
        
        mainLogger.info(`[世界书管理] 加载世界书: ${lorebookName}`);
        const bookData = await loadWorldInfo(lorebookName);
        
        if (!bookData || !bookData.entries) {
            throw new Error(`无法加载世界书"${lorebookName}"`);
        }
        
        const totalEntries = Object.keys(bookData.entries).length;
        mainLogger.info(`[世界书管理] 世界书共有 ${totalEntries} 个条目`);
        
        // 2. 获取所有条目信息供AI分析
        const entriesInfo = Object.values(bookData.entries).map(entry => ({
            uid: entry.uid,
            comment: entry.comment || '',
            key: Array.isArray(entry.key) ? entry.key.join(', ') : entry.key,
            content: (entry.content || '').substring(0, 100)
        }));
        
        const entriesText = entriesInfo.map(e => 
            `[UID:${e.uid}] 备注:"${e.comment}" | 关键词:"${e.key}" | 内容预览:"${e.content}..."`
        ).join('\n');
        
        mainLogger.info(`[世界书管理] 条目信息已收集`);
        
        // 3. 让AI分析用户指令并决定删除哪些条目
        const aiPrompt = `你是一个智能世界书管理助手。用户给了你一个删除指令，你需要分析并决定删除哪些条目。

用户指令：
${instruction}

当前世界书条目列表：
${entriesText}

请分析用户指令，然后按以下JSON格式输出要删除的条目UID列表：
{
  "uids": [0, 1, 2],
  "reason": "删除原因说明",
  "confirm_message": "给用户的确认信息"
}

常见指令示例：
- "删除所有日志条目" → 删除所有comment包含"角色日志"的条目
- "删除长离和秧秧的条目" → 删除key或comment包含"长离"或"秧秧"的条目
- "删除所有条目" → 删除所有条目
- "删除UID为1和2的条目" → 删除指定UID的条目

注意：
1. 只输出JSON，不要有其他文字
2. 如果指令不明确或没有匹配的条目，输出 {"uids": [], "reason": "原因", "confirm_message": "信息"}
3. UID必须是实际存在的条目UID`;

        let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
        if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl += '/chat/completions';
        }
        
        const body = {
            model: settings.model,
            messages: [
                { role: 'system', content: '你是一个智能世界书管理助手，擅长分析用户的删除指令。只输出JSON格式的结果，不要添加任何解释。' },
                { role: 'user', content: aiPrompt }
            ],
            temperature: 0.2,
            max_tokens: 20000,
            stream: false,
        };
        
        mainLogger.info(`[世界书管理] 正在调用AI分析删除指令...`);
        
        // 使用统一的AI调用函数
        const content = await callAI({
            apiUrl: settings.apiUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            prompt: aiPrompt,
            maxTokens: MAX_TOKENS.DELETE_ANALYSIS,
            temperature: 0.2,
            systemPrompt: '你是一个智能世界书管理助手，擅长分析用户的删除指令。只输出JSON格式的结果，不要添加任何解释。'
        });
        
        if (!content) {
            throw new Error("AI未返回任何内容");
        }
        
        mainLogger.info(`[世界书管理] AI响应: ${content.substring(0, 200)}...`);
        
        // 4. 使用统一的JSON解析函数
        const result = safeParseJSON(content, 'uids');
        
        if (!result) {
            throw new Error("无法解析AI响应");
        }
        
        if (!result.uids || !Array.isArray(result.uids)) {
            throw new Error("AI响应格式不正确");
        }
        
        mainLogger.info(`[世界书管理] AI决定删除 ${result.uids.length} 个条目`);
        mainLogger.info(`[世界书管理] 原因: ${result.reason}`);
        
        if (result.uids.length === 0) {
            mainLogger.info(`[世界书管理] 没有需要删除的条目`);
            toastr.info(result.confirm_message || "没有找到匹配的条目", "世界书管理");
            return { total: 0, deleted: 0, failed: 0 };
        }
        
        // 5. 显示确认信息
        toastr.info(result.confirm_message || `准备删除 ${result.uids.length} 个条目`, "世界书管理", { timeOut: 3000 });
        
        // 6. 执行删除
        const deleteResults = {
            total: result.uids.length,
            deleted: 0,
            failed: 0,
            details: []
        };
        
        for (const uid of result.uids) {
            try {
                if (bookData.entries[uid]) {
                    const entryInfo = `[UID:${uid}] ${bookData.entries[uid].comment || ''}`;
                    delete bookData.entries[uid];
                    deleteResults.deleted++;
                    deleteResults.details.push({ uid, status: 'success', info: entryInfo });
                    mainLogger.success(`[世界书管理] ✓ 已删除: ${entryInfo}`);
                } else {
                    deleteResults.failed++;
                    deleteResults.details.push({ uid, status: 'failed', error: '条目不存在' });
                    mainLogger.warn(`[世界书管理] ✗ UID ${uid} 不存在`);
                }
            } catch (error) {
                deleteResults.failed++;
                deleteResults.details.push({ uid, status: 'failed', error: error.message });
                mainLogger.error(`[世界书管理] ✗ 删除 UID ${uid} 失败: ${error.message}`);
            }
        }
        
        // 7. 保存世界书
        if (deleteResults.deleted > 0) {
            mainLogger.info(`[世界书管理] 正在保存世界书...`);
            await saveWorldInfo(lorebookName, bookData, true);
            mainLogger.success(`[世界书管理] 世界书已保存`);
        }
        
        // 8. 输出汇总
        mainLogger.success(`[世界书管理] ========== 删除操作完成 ==========`);
        mainLogger.info(`[世界书管理] 总计: ${deleteResults.total} | 成功: ${deleteResults.deleted} | 失败: ${deleteResults.failed}`);
        
        toastr.success(
            `删除完成！成功: ${deleteResults.deleted} | 失败: ${deleteResults.failed}`,
            "世界书管理",
            { timeOut: 5000 }
        );
        
        return deleteResults;
        
    } catch (error) {
        mainLogger.error("[世界书管理] 删除操作失败", error.message);
        toastr.error(`删除失败: ${error.message}`, "世界书管理");
        throw error;
    }
}

/**
 * 一键删除所有日志条目
 * @returns {Promise<Object>} 删除结果统计
 */
export async function deleteAllDiaryEntries() {
    return await deleteWorldBookEntries("删除所有日志条目");
}

/**
 * 删除指定角色的所有相关条目
 * @param {string} characterNames - 角色名称（逗号分隔，如："长离,秧秧"）
 * @returns {Promise<Object>} 删除结果统计
 */
export async function deleteCharacterEntries(characterNames) {
    return await deleteWorldBookEntries(`删除${characterNames}的所有条目`);
}
