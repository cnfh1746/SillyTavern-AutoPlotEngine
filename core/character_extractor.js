/**
 * @file character_extractor.js
 * @description 角色信息提取器 - 从上下文中提取并生成角色信息
 */

import { mainLogger } from './logger.js';
import { getSettings } from './settingsManager.js';
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry } from "/scripts/world-info.js";

const { toastr, TavernHelper } = window;

/**
 * 生成用于提取角色信息的提示词
 * @param {string} characterName - 角色名称
 * @param {string} context - 上下文信息
 * @returns {string} 完整的提示词
 */
function buildCharacterExtractionPrompt(characterName, context) {
    return `你是一个专业的角色分析师。请仔细阅读下面的上下文信息，提取关于"${characterName}"这个角色的所有相关信息。

上下文信息：
${context}

请分析并生成关于"${characterName}"的详细角色信息，包括但不限于：
- 基本信息（姓名、年龄、性别、外貌特征等）
- 性格特点
- 背景故事
- 能力/技能
- 人际关系
- 重要经历
- 其他重要信息

请用简洁但详细的方式描述，确保信息准确且来源于提供的上下文。如果某些信息在上下文中未提及，请不要编造。

输出格式：
以自然段落的形式输出，不需要使用列表或特殊格式。直接描述角色的各个方面即可。`;
}

/**
 * 从角色名称生成合适的触发关键词
 * @param {string} characterName - 角色名称
 * @returns {Array<string>} 关键词数组
 */
function generateKeywordsFromName(characterName) {
    const keywords = [characterName];
    
    // 如果是中文名字，尝试添加姓氏和名字
    if (/[\u4e00-\u9fa5]/.test(characterName)) {
        if (characterName.length >= 2) {
            keywords.push(characterName.substring(0, 1)); // 姓氏
            if (characterName.length >= 3) {
                keywords.push(characterName.substring(1)); // 名字
            }
        }
    }
    
    // 如果是英文名字，添加小写版本
    if (/[a-zA-Z]/.test(characterName)) {
        keywords.push(characterName.toLowerCase());
        keywords.push(characterName.toUpperCase());
    }
    
    return [...new Set(keywords)]; // 去重
}

/**
 * 获取当前聊天的上下文信息
 * @returns {string} 格式化的上下文
 */
function getCurrentContext() {
    const context = window.SillyTavern.getContext();
    let contextText = '';
    
    // 添加角色卡信息
    if (context.characters && context.characters[context.characterId]) {
        const char = context.characters[context.characterId];
        contextText += `=== 角色卡信息 ===\n`;
        contextText += `名称: ${char.name || '未知'}\n`;
        if (char.description) contextText += `描述: ${char.description}\n`;
        if (char.personality) contextText += `性格: ${char.personality}\n`;
        if (char.scenario) contextText += `场景: ${char.scenario}\n`;
        if (char.mes_example) contextText += `示例对话: ${char.mes_example}\n`;
        contextText += `\n`;
    }
    
    // 添加最近的聊天记录
    if (context.chat && context.chat.length > 0) {
        contextText += `=== 聊天记录 ===\n`;
        const recentMessages = context.chat.slice(-50); // 最近50条消息
        recentMessages.forEach(msg => {
            const speaker = msg.is_user ? '用户' : (msg.name || 'AI');
            contextText += `${speaker}: ${msg.mes}\n`;
        });
    }
    
    return contextText;
}

/**
 * 调用API生成角色信息
 * @param {Object} settings - 设置对象
 * @param {string} prompt - 提示词
 * @returns {Promise<string|null>} 生成的角色信息或null
 */
async function callCharacterExtractionAPI(settings, prompt) {
    if (!settings.apiUrl || !settings.apiKey || !settings.model) {
        mainLogger.error("[角色提取] API配置不完整");
        toastr.error("API配置不完整，请在设置中配置API信息", "角色提取");
        return null;
    }
    
    // 规范化URL
    let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
    if (!apiUrl.endsWith('/chat/completions')) {
        apiUrl += '/chat/completions';
    }
    
    // 构建请求体
    const body = {
        model: settings.model,
        messages: [
            { 
                role: 'system', 
                content: '你是一个专业的角色分析师，擅长从对话和描述中提取和整理角色信息。请仔细分析提供的内容，生成详细准确的角色描述。'
            },
            { role: 'user', content: prompt }
        ],
        temperature: parseFloat(settings.temperature) || 0.7,
        max_tokens: parseInt(settings.maxTokens) || 4000,
        top_p: parseFloat(settings.topP) || 1.0,
        presence_penalty: parseFloat(settings.presencePenalty) || 0,
        frequency_penalty: parseFloat(settings.frequencyPenalty) || 0,
        stream: false,
    };
    
    mainLogger.info(`[角色提取] 正在调用API: ${apiUrl}`);
    mainLogger.info(`[角色提取] 使用模型: ${settings.model}`);
    
    try {
        const response = await fetch(apiUrl, {
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
            mainLogger.success(`[角色提取] API调用成功，生成内容长度: ${content.length} 字符`);
            return content;
        } else {
            mainLogger.warn("[角色提取] API返回成功但内容为空或格式无效");
            return null;
        }

    } catch (error) {
        mainLogger.error("[角色提取] API调用失败", error.message);
        toastr.error(`API调用失败: ${error.message}`, "角色提取");
        return null;
    }
}

/**
 * 创建或更新角色世界书条目（使用与plot_engine相同的方法）
 * @param {string} characterName - 角色名称
 * @param {string} content - 角色信息内容
 * @param {Array<string>} keywords - 触发关键词
 */
async function createCharacterEntry(characterName, content, keywords) {
    mainLogger.info(`[角色提取] 正在创建世界书条目: ${characterName}`);
    
    try {
        // Step 1: 获取当前角色卡的主世界书（与plot_engine完全相同的方法）
        mainLogger.info("[角色提取] 正在获取当前角色卡的主世界书...");
        
        if (!TavernHelper || typeof TavernHelper.getCurrentCharPrimaryLorebook !== 'function') {
            throw new Error("TavernHelper API 不可用，无法获取角色卡世界书");
        }
        
        const lorebookName = await TavernHelper.getCurrentCharPrimaryLorebook();
        
        if (!lorebookName) {
            throw new Error("当前角色没有绑定世界书，请先为角色卡设置主世界书");
        }
        
        mainLogger.info(`[角色提取] 找到角色卡主世界书: ${lorebookName}`);

        // Step 2: 加载世界书数据
        mainLogger.info(`[角色提取] 正在加载世界书"${lorebookName}"...`);
        const bookData = await loadWorldInfo(lorebookName);
        
        if (!bookData) {
            throw new Error(`无法加载世界书"${lorebookName}"`);
        }
        
        const entriesCount = Object.keys(bookData.entries || {}).length;
        mainLogger.info(`[角色提取] 世界书加载成功，当前条目数: ${entriesCount}`);

        // Step 3: 查找是否已存在该角色的条目
        const commentPrefix = `角色信息: ${characterName}`;
        let existingEntry = null;
        
        if (bookData.entries) {
            existingEntry = Object.values(bookData.entries).find(
                entry => entry && entry.comment && entry.comment.startsWith(commentPrefix)
            );
        }
        
        if (existingEntry) {
            // 更新现有条目
            mainLogger.info(`[角色提取] 找到现有条目 (uid: ${existingEntry.uid})，正在更新...`);
            existingEntry.content = content;
            existingEntry.key = keywords;
            existingEntry.comment = `${commentPrefix} - ${new Date().toISOString()}`;
            existingEntry.disable = false;
            mainLogger.success(`[角色提取] 条目更新完成`);
        } else {
            // 创建新条目
            mainLogger.info(`[角色提取] 未找到现有条目，正在创建新条目...`);
            const newEntry = createWorldInfoEntry(lorebookName, bookData);
            
            mainLogger.info(`[角色提取] createWorldInfoEntry返回的条目uid: ${newEntry.uid}`);
            
            // 设置条目属性
            Object.assign(newEntry, {
                comment: `${commentPrefix} - ${new Date().toISOString()}`,
                content: content,
                key: keywords,
                constant: false,  // 绿灯模式：按关键词触发
                selectiveLogic: 0,
                position: 0,  // Before Char（角色定义之前）
                depth: 4,
                disable: false,
                order: 100,
                probability: 100,
            });
            
            // 确保条目在 bookData.entries 中
            if (bookData.entries && !bookData.entries[newEntry.uid]) {
                mainLogger.warn(`[角色提取] 条目未自动添加到entries，手动添加 (uid: ${newEntry.uid})`);
                bookData.entries[newEntry.uid] = newEntry;
            } else {
                mainLogger.info(`[角色提取] 条目已在entries中 (uid: ${newEntry.uid})`);
            }
            
            const newEntriesCount = Object.keys(bookData.entries || {}).length;
            mainLogger.success(`[角色提取] 新条目创建完成，当前总条目数: ${newEntriesCount}`);
        }

        // Step 4: 保存世界书
        mainLogger.info(`[角色提取] 正在保存世界书...`);
        await saveWorldInfo(lorebookName, bookData, true);
        mainLogger.success(`[角色提取] 角色信息已成功写入世界书！`);
        
        return true;
        
    } catch (error) {
        mainLogger.error("[角色提取] 创建条目失败", error.message);
        toastr.error(`创建角色条目失败: ${error.message}`, "角色提取");
        return false;
    }
}

/**
 * 主函数：提取角色信息
 * @param {string} characterName - 角色名称
 */
export async function extractCharacterInfo(characterName) {
    if (!characterName || characterName.trim() === '') {
        mainLogger.error("[角色提取] 角色名称不能为空");
        return false;
    }
    
    characterName = characterName.trim();
    mainLogger.info(`[角色提取] 开始提取角色信息: ${characterName}`);
    
    try {
        // 1. 获取当前上下文
        mainLogger.info("[角色提取] 步骤 1/4: 正在收集上下文信息...");
        const context = getCurrentContext();
        
        if (!context) {
            mainLogger.error("[角色提取] 无法获取上下文信息");
            return false;
        }
        
        mainLogger.info(`[角色提取] 上下文收集完成，总长度: ${context.length} 字符`);
        
        // 2. 构建提示词
        mainLogger.info("[角色提取] 步骤 2/4: 正在构建提示词...");
        const prompt = buildCharacterExtractionPrompt(characterName, context);
        
        // 3. 调用API生成角色信息
        mainLogger.info("[角色提取] 步骤 3/4: 正在调用AI提取角色信息...");
        
        const settings = getSettings();
        const characterInfo = await callCharacterExtractionAPI(settings, prompt);
        
        if (!characterInfo) {
            mainLogger.error("[角色提取] AI未返回有效的角色信息");
            toastr.error("AI未返回有效的角色信息", "角色提取");
            return false;
        }
        
        mainLogger.success(`[角色提取] 角色信息生成完成，内容长度: ${characterInfo.length} 字符`);
        
        // 4. 生成关键词并创建世界书条目
        mainLogger.info("[角色提取] 步骤 4/4: 正在创建世界书条目...");
        const keywords = generateKeywordsFromName(characterName);
        mainLogger.info(`[角色提取] 生成触发关键词: ${keywords.join(', ')}`);
        
        const success = await createCharacterEntry(characterName, characterInfo, keywords);
        
        if (success) {
            mainLogger.success(`[角色提取] ========== 角色信息提取完成 ==========`);
            mainLogger.info(`[角色提取] 角色: ${characterName}`);
            mainLogger.info(`[角色提取] 关键词: ${keywords.join(', ')}`);
            mainLogger.info(`[角色提取] 位置: 角色定义之前 (Before Char)`);
            mainLogger.info(`[角色提取] 状态: 绿灯 (按触发词激活)`);
        }
        
        return success;
        
    } catch (error) {
        mainLogger.error("[角色提取] 提取过程出错", error.message);
        return false;
    }
}
