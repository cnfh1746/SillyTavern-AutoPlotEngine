/**
 * @file character_extractor.js
 * @description 角色信息提取器 - 从上下文中提取并生成角色信息
 */

import { callBackendAPI } from './api.js';
import { getSettings } from './settingsManager.js';
import { mainLogger } from './logger.js';

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
 * 创建或更新角色世界书条目
 * @param {string} characterName - 角色名称
 * @param {string} content - 角色信息内容
 * @param {Array<string>} keywords - 触发关键词
 */
async function createCharacterEntry(characterName, content, keywords) {
    mainLogger.info(`[角色提取] 正在创建世界书条目: ${characterName}`);
    
    try {
        const context = window.SillyTavern.getContext();
        
        // 获取或创建角色世界书
        let bookName = `角色信息_${characterName}`;
        let worldInfoData = context.worldInfoData;
        
        if (!worldInfoData) {
            mainLogger.error("[角色提取] 无法访问世界书数据");
            return false;
        }
        
        // 查找是否存在同名世界书
        let targetBook = null;
        for (let name in worldInfoData) {
            if (name === bookName) {
                targetBook = worldInfoData[name];
                break;
            }
        }
        
        // 如果没有找到，使用主世界书（角色卡世界书）
        if (!targetBook) {
            mainLogger.info(`[角色提取] 使用角色卡主世界书`);
            const charId = context.characterId;
            if (context.characters && context.characters[charId]) {
                const char = context.characters[charId];
                if (char.data && char.data.character_book) {
                    targetBook = char.data.character_book;
                }
            }
        }
        
        if (!targetBook) {
            mainLogger.error("[角色提取] 无法找到或创建世界书");
            return false;
        }
        
        // 创建新条目
        const newEntry = {
            uid: Date.now(),
            key: keywords,
            keysecondary: [],
            comment: `角色信息: ${characterName}`,
            content: content,
            constant: false, // 绿灯：按触发词触发
            selective: true,
            selectiveLogic: 0,
            addMemo: false,
            order: 100,
            position: 0, // 0 = Before Char（角色定义之前）
            disable: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            probability: 100,
            useProbability: true,
            depth: 4,
            group: "",
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: false,
            matchWholeWords: false,
            useGroupScoring: false,
            automationId: "",
            role: 0,
            vectorized: false,
            sticky: 0,
            cooldown: 0,
            delay: 0
        };
        
        // 添加到世界书
        if (!targetBook.entries) {
            targetBook.entries = {};
        }
        
        targetBook.entries[newEntry.uid] = newEntry;
        
        mainLogger.success(`[角色提取] 条目创建成功 (uid: ${newEntry.uid})`);
        
        // 保存世界书
        await saveWorldInfo();
        
        // 刷新UI
        if (window.setWorldInfoButtonClass) {
            window.setWorldInfoButtonClass(context.chat_id);
        }
        
        return true;
        
    } catch (error) {
        mainLogger.error("[角色提取] 创建条目失败", error.message);
        return false;
    }
}

/**
 * 保存世界书数据
 */
async function saveWorldInfo() {
    try {
        const context = window.SillyTavern.getContext();
        const charId = context.characterId;
        
        if (context.characters && context.characters[charId]) {
            const char = context.characters[charId];
            
            // 调用SillyTavern的保存函数
            if (window.saveCharacterBook) {
                await window.saveCharacterBook(charId);
                mainLogger.success("[角色提取] 世界书已保存");
            } else {
                mainLogger.warn("[角色提取] 找不到保存函数，尝试手动保存");
                // 尝试直接保存
                const response = await fetch('/api/characters/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        avatar: char.avatar,
                        data: char.data
                    })
                });
                
                if (response.ok) {
                    mainLogger.success("[角色提取] 世界书保存成功");
                } else {
                    mainLogger.error("[角色提取] 保存失败");
                }
            }
        }
    } catch (error) {
        mainLogger.error("[角色提取] 保存世界书时出错", error.message);
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
        
        const characterInfo = await callBackendAPI(prompt, {
            apiUrl: settings.apiUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            maxTokens: 2000, // 角色信息不需要太长
            temperature: 0.3, // 降低温度以获得更准确的信息
            topP: settings.topP,
            presencePenalty: settings.presencePenalty,
            frequencyPenalty: settings.frequencyPenalty
        });
        
        if (!characterInfo) {
            mainLogger.error("[角色提取] AI返回内容为空");
            return false;
        }
        
        mainLogger.success(`[角色提取] AI生成完成，内容长度: ${characterInfo.length} 字符`);
        
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
