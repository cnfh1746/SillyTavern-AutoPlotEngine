/**
 * @file plot_engine.js
 * @description
 * This is the core of the Auto Plot Engine. It orchestrates the process of
 * fetching the current world state, calling a secondary AI to generate a 
 * plot outline, and then injecting that outline into a dedicated lorebook.
 */

import { getAllContext } from './information_aggregator.js';
import { getSettings } from './settingsManager.js';
import { loadWorldInfo, createNewWorldInfo, saveWorldInfo, world_names, createWorldInfoEntry } from "/scripts/world-info.js";
import { eventSource, event_types } from "/script.js";
import { plotLogger, apiLogger } from './logger.js';

const { toastr, TavernHelper } = window;

// ==================== 优化7: 常量提取 ====================
const CONSTANTS = {
    ENTRY_COMMENT: "AI组手剧情大纲",
    HISTORY_COMMENT: "AI组手历史版本",
    MAX_ALLOWED_TOKENS: 65536,
    MAX_HISTORY_VERSIONS: 5,
    API_RETRY_ATTEMPTS: 3,
    API_RETRY_DELAY: 2000, // 毫秒
    DEFAULT_KEYWORDS: ["剧情", "plot", "大纲", "故事", "情节"],
    DEFAULT_POSITION: 4,
    DEFAULT_DEPTH: 1,
    DEFAULT_ORDER: 100,
    DEFAULT_PROBABILITY: 100,
};

// ==================== 优化9: 类型安全增强 ====================
/**
 * @typedef {Object} WorldBookEntry
 * @property {number} uid - 条目唯一ID
 * @property {string} comment - 条目注释
 * @property {string} content - 条目内容
 * @property {string[]} key - 触发关键词数组
 * @property {boolean} constant - 是否为常驻条目
 * @property {number} selectiveLogic - 选择逻辑
 * @property {number} position - 插入位置
 * @property {number} depth - 插入深度
 * @property {boolean} disable - 是否禁用
 * @property {boolean} enabled - 是否启用
 * @property {number} order - 排序顺序
 * @property {number} probability - 触发概率
 */

/**
 * @typedef {Object} ApiSettings
 * @property {string} apiUrl - API地址
 * @property {string} apiKey - API密钥
 * @property {string} model - 模型名称
 * @property {number} maxTokens - 最大token数
 * @property {number} temperature - 温度参数
 * @property {number} topP - Top P参数
 * @property {number} presencePenalty - 存在惩罚
 * @property {number} frequencyPenalty - 频率惩罚
 * @property {string} plotMasterPrompt - 核心提示词
 * @property {string[]} entryKeywords - 触发关键词
 * @property {number} entryPosition - 插入位置
 * @property {number} entryDepth - 插入深度
 */

// ==================== 优化8: 函数职责分离 ====================

/**
 * 验证API配置的完整性
 * @param {ApiSettings} settings - API设置对象
 * @returns {boolean} 配置是否完整
 */
function validateApiConfig(settings) {
    if (!settings || typeof settings !== 'object') {
        apiLogger.error("API配置对象无效");
        return false;
    }
    
    const requiredFields = ['apiUrl', 'apiKey', 'model'];
    const missingFields = requiredFields.filter(field => !settings[field]);
    
    if (missingFields.length > 0) {
        apiLogger.error("API配置不完整", {
            missingFields,
            hasUrl: !!settings.apiUrl,
            hasKey: !!settings.apiKey,
            hasModel: !!settings.model
        });
        return false;
    }
    
    return true;
}

/**
 * 规范化API URL
 * @param {string} apiUrl - 原始API URL
 * @returns {string} 规范化后的URL
 */
function normalizeApiUrl(apiUrl) {
    if (!apiUrl || typeof apiUrl !== 'string') {
        throw new Error('API URL 无效');
    }
    
    let normalized = apiUrl.trim().replace(/\/$/, '');
    
    if (!normalized.endsWith('/chat/completions')) {
        normalized += '/chat/completions';
    }
    
    return normalized;
}

/**
 * 限制token数量在合理范围内
 * @param {number} maxTokens - 请求的最大token数
 * @returns {number} 限制后的token数
 */
function limitTokens(maxTokens) {
    const tokens = parseInt(maxTokens) || 4000;
    
    if (tokens > CONSTANTS.MAX_ALLOWED_TOKENS) {
        apiLogger.warn(`max_tokens ${tokens} 超出限制，将限制为 ${CONSTANTS.MAX_ALLOWED_TOKENS}`);
        return CONSTANTS.MAX_ALLOWED_TOKENS;
    }
    
    if (tokens < 100) {
        apiLogger.warn(`max_tokens ${tokens} 过小，将设置为 100`);
        return 100;
    }
    
    return tokens;
}

/**
 * 构建API请求体
 * @param {ApiSettings} settings - API设置
 * @param {string} prompt - 用户提示词
 * @returns {Object} 请求体对象
 */
function buildApiRequestBody(settings, prompt) {
    return {
        model: settings.model,
        messages: [
            { role: 'system', content: settings.plotMasterPrompt },
            { role: 'user', content: prompt }
        ],
        temperature: parseFloat(settings.temperature) || 0.7,
        max_tokens: limitTokens(settings.maxTokens),
        top_p: parseFloat(settings.topP) || 1.0,
        presence_penalty: parseFloat(settings.presencePenalty) || 0,
        frequency_penalty: parseFloat(settings.frequencyPenalty) || 0,
        stream: false,
    };
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ==================== 优化6: API 重试机制 ====================
 * 带重试的API调用函数
 * @param {string} url - API地址
 * @param {Object} options - fetch选项
 * @param {number} attempt - 当前尝试次数
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, attempt = 1) {
    try {
        apiLogger.info(`API调用尝试 ${attempt}/${CONSTANTS.API_RETRY_ATTEMPTS}`);
        const response = await fetch(url, options);
        
        // 如果是服务器错误(5xx)或特定的客户端错误(429限流)，可以重试
        if ((response.status >= 500 || response.status === 429) && attempt < CONSTANTS.API_RETRY_ATTEMPTS) {
            const retryDelay = CONSTANTS.API_RETRY_DELAY * attempt; // 指数退避
            apiLogger.warn(`API返回错误 ${response.status}，${retryDelay}ms后重试...`);
            await delay(retryDelay);
            return fetchWithRetry(url, options, attempt + 1);
        }
        
        return response;
    } catch (error) {
        // 网络错误可以重试
        if (attempt < CONSTANTS.API_RETRY_ATTEMPTS) {
            const retryDelay = CONSTANTS.API_RETRY_DELAY * attempt;
            apiLogger.warn(`网络错误，${retryDelay}ms后重试: ${error.message}`);
            await delay(retryDelay);
            return fetchWithRetry(url, options, attempt + 1);
        }
        throw error;
    }
}

/**
 * 从时间戳注释中提取时间
 * @param {string} comment - 注释字符串
 * @returns {Date} 时间对象
 */
function extractTimestamp(comment) {
    if (!comment || typeof comment !== 'string') {
        return new Date(0);
    }
    
    const parts = comment.split(' - ');
    if (parts.length < 2) {
        return new Date(0);
    }
    
    return new Date(parts[1]);
}

/**
 * 查找所有匹配的条目
 * @param {Object} entries - 世界书条目对象
 * @param {string} commentPrefix - 注释前缀
 * @returns {WorldBookEntry[]} 匹配的条目数组
 */
function findMatchingEntries(entries, commentPrefix) {
    if (!entries || typeof entries !== 'object') {
        return [];
    }
    
    return Object.values(entries).filter(
        entry => entry && entry.comment && entry.comment.startsWith(commentPrefix)
    );
}

/**
 * ==================== 优化5: 保留历史版本 ====================
 * 创建历史版本条目
 * @param {string} lorebookName - 世界书名称
 * @param {Object} bookData - 世界书数据
 * @param {string} content - 要保存的内容
 * @param {number} versionNumber - 版本号
 * @returns {WorldBookEntry} 新创建的历史条目
 */
function createHistoryEntry(lorebookName, bookData, content, versionNumber) {
    const historyEntry = createWorldInfoEntry(lorebookName, bookData);
    const timestamp = new Date().toISOString();
    
    Object.assign(historyEntry, {
        comment: `${CONSTANTS.HISTORY_COMMENT} #${versionNumber} - ${timestamp}`,
        content: content,
        key: [`历史版本${versionNumber}`, `history_v${versionNumber}`],
        constant: false, // 历史版本默认不激活
        selectiveLogic: 0,
        position: CONSTANTS.DEFAULT_POSITION,
        depth: CONSTANTS.DEFAULT_DEPTH + 1, // 比主条目深度+1
        disable: true, // 默认禁用
        enabled: false,
        order: CONSTANTS.DEFAULT_ORDER + versionNumber,
        probability: CONSTANTS.DEFAULT_PROBABILITY,
    });
    
    return historyEntry;
}

/**
 * 管理历史版本，保留最新的N个版本
 * @param {Object} bookData - 世界书数据
 * @param {string} currentContent - 当前内容
 * @param {string} lorebookName - 世界书名称
 */
function manageHistoryVersions(bookData, currentContent, lorebookName) {
    if (!bookData.entries) {
        return;
    }
    
    // 查找所有历史版本
    const historyEntries = findMatchingEntries(bookData.entries, CONSTANTS.HISTORY_COMMENT);
    
    plotLogger.info(`当前历史版本数: ${historyEntries.length}`);
    
    // 如果超过最大保留数量，删除最旧的
    if (historyEntries.length >= CONSTANTS.MAX_HISTORY_VERSIONS) {
        // 按时间排序
        historyEntries.sort((a, b) => {
            const timeA = extractTimestamp(a.comment);
            const timeB = extractTimestamp(b.comment);
            return timeA - timeB; // 升序，最旧的在前
        });
        
        // 删除最旧的版本
        const toDelete = historyEntries.length - CONSTANTS.MAX_HISTORY_VERSIONS + 1;
        for (let i = 0; i < toDelete; i++) {
            delete bookData.entries[historyEntries[i].uid];
            plotLogger.info(`已删除历史版本 uid: ${historyEntries[i].uid}`);
        }
    }
    
    // 创建新的历史版本
    const nextVersion = historyEntries.length - (historyEntries.length - CONSTANTS.MAX_HISTORY_VERSIONS + 1) + 1;
    const newHistoryEntry = createHistoryEntry(lorebookName, bookData, currentContent, nextVersion);
    
    if (!bookData.entries[newHistoryEntry.uid]) {
        bookData.entries[newHistoryEntry.uid] = newHistoryEntry;
    }
    
    plotLogger.success(`已创建历史版本 #${nextVersion} (uid: ${newHistoryEntry.uid})`);
}

/**
 * 清理旧的重复条目
 * @param {Object} bookData - 世界书数据
 * @returns {WorldBookEntry|null} 保留的最新条目，如果没有则返回null
 */
function cleanupDuplicateEntries(bookData) {
    if (!bookData.entries) {
        return null;
    }
    
    const allMatchingEntries = findMatchingEntries(bookData.entries, CONSTANTS.ENTRY_COMMENT);
    
    if (allMatchingEntries.length > 1) {
        plotLogger.warn(`发现 ${allMatchingEntries.length} 个剧情条目，保留最新的并删除旧条目`);
        
        // 按时间戳排序，保留最新的
        allMatchingEntries.sort((a, b) => {
            const timeA = extractTimestamp(a.comment);
            const timeB = extractTimestamp(b.comment);
            return timeB - timeA; // 降序，最新的在前
        });
        
        // 删除旧条目
        for (let i = 1; i < allMatchingEntries.length; i++) {
            delete bookData.entries[allMatchingEntries[i].uid];
            plotLogger.info(`已删除旧条目 uid: ${allMatchingEntries[i].uid}`);
        }
    }
    
    return allMatchingEntries[0] || null;
}

/**
 * 配置条目的基本属性
 * @param {WorldBookEntry} entry - 要配置的条目
 * @param {ApiSettings} settings - 设置对象
 */
function configureEntryProperties(entry, settings) {
    if (!entry || typeof entry !== 'object') {
        throw new Error('条目对象无效');
    }
    
    // 确保条目被启用
    entry.disable = false;
    entry.enabled = true;
    
    // 设置触发关键词
    if (!entry.key || entry.key.length === 0) {
        entry.key = settings.entryKeywords || CONSTANTS.DEFAULT_KEYWORDS;
    }
    
    // 确保是常驻条目
    entry.constant = true;
    
    // 设置位置和深度
    entry.position = settings.entryPosition ?? CONSTANTS.DEFAULT_POSITION;
    entry.depth = settings.entryDepth ?? CONSTANTS.DEFAULT_DEPTH;
    
    // 设置其他属性
    entry.order = CONSTANTS.DEFAULT_ORDER;
    entry.probability = CONSTANTS.DEFAULT_PROBABILITY;
}

/**
 * 获取当前角色的主世界书名称
 * @returns {Promise<string>} 世界书名称
 * @throws {Error} 如果无法获取世界书
 */
async function getCurrentLorebook() {
    if (!TavernHelper || typeof TavernHelper.getCurrentCharPrimaryLorebook !== 'function') {
        throw new Error("TavernHelper API 不可用，无法获取角色卡世界书");
    }
    
    const lorebookName = await TavernHelper.getCurrentCharPrimaryLorebook();
    
    if (!lorebookName) {
        throw new Error("当前角色没有绑定世界书，请先为角色卡设置主世界书");
    }
    
    return lorebookName;
}

/**
 * 触发UI刷新事件
 * @param {string} lorebookName - 世界书名称
 */
function triggerUIRefresh(lorebookName) {
    if (typeof eventSource === 'undefined' || !eventSource || typeof eventSource.emit !== 'function') {
        plotLogger.warn('eventSource不可用，无法触发UI刷新');
        return;
    }
    
    // 触发多个事件确保UI更新
    if (event_types.WORLDINFO_UPDATED) {
        eventSource.emit(event_types.WORLDINFO_UPDATED, lorebookName);
    }
    if (event_types.WORLDINFO_SETTINGS_UPDATED) {
        eventSource.emit(event_types.WORLDINFO_SETTINGS_UPDATED);
    }
    // 重新加载角色页面以刷新世界书列表
    if (event_types.CHARACTER_PAGE_LOADED) {
        eventSource.emit(event_types.CHARACTER_PAGE_LOADED);
    }
    
    plotLogger.info('UI刷新信号已发送');
}

/**
 * Updates the dedicated lorebook with the new plot outline.
 * Creates the lorebook and entry if they don't exist.
 * @param {string} outlineContent - The plot outline generated by the AI.
 */
async function updatePlotLorebook(outlineContent) {
    if (!outlineContent || typeof outlineContent !== 'string') {
        plotLogger.warn("没有提供有效的剧情大纲内容，跳过世界书更新");
        return;
    }

    try {
        // Step 1: 获取当前角色卡的主世界书
        plotLogger.info("正在获取当前角色卡的主世界书...");
        const lorebookName = await getCurrentLorebook();
        plotLogger.info(`找到角色卡主世界书: ${lorebookName}`);

        // Step 2: Load the lorebook data
        plotLogger.info(`正在加载角色卡世界书"${lorebookName}"...`);
        const bookData = await loadWorldInfo(lorebookName);
        if (!bookData) {
            throw new Error(`无法加载世界书"${lorebookName}"`);
        }
        
        const entriesCount = Object.keys(bookData.entries || {}).length;
        plotLogger.info(`世界书加载成功，当前条目数: ${entriesCount}`);

        // Step 3: 清理重复条目
        const existingEntry = cleanupDuplicateEntries(bookData);
        const settings = getSettings();
        
        if (existingEntry) {
            plotLogger.info(`找到现有条目 (uid: ${existingEntry.uid})，正在更新...`);
            
            // 优化4: 内容去重检测
            if (existingEntry.content === outlineContent) {
                plotLogger.info("剧情内容未变化，跳过更新");
                toastr.info("剧情大纲内容未变化", "AI组手");
                return;
            }
            
            plotLogger.info(`内容已变化 (旧: ${existingEntry.content.length}字符, 新: ${outlineContent.length}字符)`);
            
            // 优化5: 保存旧内容为历史版本
            manageHistoryVersions(bookData, existingEntry.content, lorebookName);
            
            // 更新内容
            existingEntry.content = outlineContent;
            existingEntry.comment = `${CONSTANTS.ENTRY_COMMENT} - ${new Date().toISOString()}`;
            
            // 配置条目属性
            configureEntryProperties(existingEntry, settings);
            
            plotLogger.success(`条目更新完成并已启用`);
        } else {
            plotLogger.info(`未找到现有条目，正在创建新条目...`);
            const newEntry = createWorldInfoEntry(lorebookName, bookData);
            
            plotLogger.debug(`createWorldInfoEntry返回的条目uid: ${newEntry.uid}`);
            
            Object.assign(newEntry, {
                comment: `${CONSTANTS.ENTRY_COMMENT} - ${new Date().toISOString()}`,
                content: outlineContent,
                key: settings.entryKeywords || CONSTANTS.DEFAULT_KEYWORDS,
                constant: true,
                selectiveLogic: 0,
                position: settings.entryPosition ?? CONSTANTS.DEFAULT_POSITION,
                depth: settings.entryDepth ?? CONSTANTS.DEFAULT_DEPTH,
                disable: false,
                order: CONSTANTS.DEFAULT_ORDER,
                probability: CONSTANTS.DEFAULT_PROBABILITY,
            });
            
            // Ensure the entry is in bookData.entries
            if (bookData.entries && !bookData.entries[newEntry.uid]) {
                plotLogger.warn(`条目未自动添加到entries，手动添加 (uid: ${newEntry.uid})`);
                bookData.entries[newEntry.uid] = newEntry;
            } else {
                plotLogger.info(`条目已在entries中 (uid: ${newEntry.uid})`);
            }
            
            const newEntriesCount = Object.keys(bookData.entries || {}).length;
            plotLogger.success(`新条目创建完成，当前总条目数: ${newEntriesCount}`);
        }

        // Step 4: Save the lorebook
        plotLogger.info(`正在保存世界书...`);
        await saveWorldInfo(lorebookName, bookData, true);
        plotLogger.success(`剧情大纲已成功写入世界书！`);
        
        // Step 5: Force UI refresh
        plotLogger.info(`正在刷新世界书UI...`);
        triggerUIRefresh(lorebookName);

    } catch (error) {
        plotLogger.error("更新世界书失败", error);
        throw error;
    }
}

/**
 * Calls the external AI to generate a plot outline.
 * @param {ApiSettings} settings - The extension settings containing API info.
 * @param {string} prompt - The fully constructed prompt.
 * @returns {Promise<string|null>} The generated plot outline or null on failure.
 */
async function callPlotGenerationAPI(settings, prompt) {
    // 验证配置
    if (!validateApiConfig(settings)) {
        return null;
    }
    
    // 规范化URL
    const apiUrl = normalizeApiUrl(settings.apiUrl);
    
    // 构建请求体
    const body = buildApiRequestBody(settings, prompt);
    
    apiLogger.info(`正在调用API: ${apiUrl}`);
    apiLogger.debug(`请求参数`, { 
        model: settings.model, 
        maxTokens: body.max_tokens, 
        temperature: body.temperature 
    });

    try {
        // 优化6: 使用带重试的fetch
        const response = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (content && typeof content === 'string') {
            apiLogger.success(`API调用成功，生成内容长度: ${content.length} 字符`);
            return content;
        } else {
            apiLogger.warn("API返回成功但内容为空或格式无效");
            return null;
        }

    } catch (error) {
        apiLogger.error("API调用失败", error.message);
        return null;
    }
}

/**
 * Main function to trigger the plot generation and update cycle.
 */
export async function runPlotGenerationCycle() {
    plotLogger.info("========== 开始剧情生成周期 ==========");
    const settings = getSettings();

    if (!settings.enabled) {
        plotLogger.warn("引擎未启用，跳过生成周期");
        return;
    }

    try {
        // 1. Get the full context
        plotLogger.info("步骤 1/4: 正在收集世界状态信息...");
        const worldState = await getAllContext();
        plotLogger.info(`世界状态收集完成，总长度: ${worldState.length} 字符`);

        // 2. Build the prompt
        plotLogger.info("步骤 2/4: 正在构建提示词...");
        const prompt = `Analyze the following world state and generate a plot outline.\n${worldState}`;
        plotLogger.debug(`提示词长度: ${prompt.length} 字符`);

        // 3. Call the plot generation AI
        plotLogger.info("步骤 3/4: 正在调用AI生成剧情大纲...");
        const plotOutline = await callPlotGenerationAPI(settings, prompt);

        // 4. Update the lorebook with the new outline
        plotLogger.info("步骤 4/4: 正在更新世界书...");
        if (plotOutline) {
            await updatePlotLorebook(plotOutline);
            toastr.success("剧情大纲已成功生成并更新到世界书！", "AI组手");
            plotLogger.success("========== 剧情生成周期完成 ==========");
        } else {
            toastr.error("剧情大纲生成失败，API 未返回有效内容。", "AI组手");
            plotLogger.error("剧情生成失败：API未返回内容");
        }
    } catch (error) {
        plotLogger.error("剧情生成周期发生错误", error.message);
        toastr.error(`剧情生成失败: ${error.message}`, "AI组手");
    }
}

/**
 * Fetches the list of available models from the API endpoint.
 * @param {ApiSettings} settings - The extension settings containing API info.
 * @returns {Promise<Array<string>|null>} A list of model names, or null on failure.
 */
export async function fetchModels(settings) {
    const { apiUrl, apiKey } = settings;

    if (!apiUrl) {
        toastr.error('API URL 未配置，无法获取模型列表。', '配置错误');
        return null;
    }

    try {
        let headers = { 'Authorization': `Bearer ${apiKey}` };
        let modelsUrl = apiUrl.replace(/\/$/, '');

        // Correctly determine the /models endpoint from the base URL
        if (modelsUrl.endsWith('/chat/completions')) {
            modelsUrl = modelsUrl.replace(/\/chat\/completions$/, '/models');
        } else if (!modelsUrl.endsWith('/models')) {
            modelsUrl += '/models';
        }

        console.log(`[AutoPlotEngine] Fetching models from: ${modelsUrl}`);
        const response = await fetch(modelsUrl, { method: 'GET', headers });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const jsonResponse = await response.json();
        const models = jsonResponse.data || [];

        if (!Array.isArray(models)) {
            throw new Error('API未返回有效的模型列表数组。');
        }

        const sortedModels = models.map(m => m.id).sort();
        toastr.success(`成功获取 ${sortedModels.length} 个模型`, '操作成功');
        return sortedModels;

    } catch (error) {
        console.error(`[AutoPlotEngine] 获取模型列表时发生网络或解析错误:`, error);
        toastr.error(`获取模型列表失败: ${error.message}`, 'API错误');
        return null;
    }
}
