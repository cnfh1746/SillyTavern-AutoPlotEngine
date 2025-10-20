/**
 * @file character_diary.js
 * @description 角色日志功能 - 自动记录角色经历并追加到现有世界书条目
 */

import { mainLogger } from './logger.js';
import { getSettings } from './settingsManager.js';
import { loadWorldInfo, saveWorldInfo } from "/scripts/world-info.js";

const { toastr, TavernHelper } = window;

/**
 * 生成角色日志的提示词
 * @param {string} characterName - 角色名称
 * @param {string} recentMessages - 最近的聊天记录
 * @returns {string} 提示词
 */
function buildDiaryPrompt(characterName, recentMessages) {
    const settings = getSettings();
    const customPrompt = settings.diaryPrompt || `你是一个专业的事件记录员。请分析下面的对话内容，为角色"${characterName}"生成一条非常精炼的历史事件记录。

要求：
1. 只记录对该角色有重要意义的事件
2. 使用第一人称（"我"）的视角
3. 格式严格遵循：YYYYMMDD 简短的事件描述（10-20字以内）
4. 只输出一条最重要的事件，不要输出多条
5. 如果对话中没有重要事件发生，请输出"无"

示例格式：
20250607 {{user}}送了我一个项链，我很喜欢
20250608 在咖啡厅遇到了老朋友

对话内容：
${recentMessages}

请生成一条事件记录：`;

    return customPrompt.replace(/\${characterName}/g, characterName).replace(/\${recentMessages}/g, recentMessages);
}

/**
 * 调用API生成角色日志
 * @param {Object} settings - 设置对象
 * @param {string} prompt - 提示词
 * @returns {Promise<string|null>} 生成的日志条目或null
 */
async function callDiaryAPI(settings, prompt) {
    if (!settings.apiUrl || !settings.apiKey || !settings.model) {
        mainLogger.error("[角色日志] API配置不完整");
        toastr.error("API配置不完整，请在设置中配置API信息", "角色日志");
        return null;
    }
    
    let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
    if (!apiUrl.endsWith('/chat/completions')) {
        apiUrl += '/chat/completions';
    }
    
    const body = {
        model: settings.model,
        messages: [
            { 
                role: 'system', 
                content: '你是一个专业的事件记录员，擅长从对话中提取关键事件并生成简洁的日志条目。'
            },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200,
        stream: false,
    };
    
    mainLogger.info(`[角色日志] 正在调用API生成日志...`);
    
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
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (content && content !== '无' && content !== 'null' && content.length > 0) {
            mainLogger.success(`[角色日志] 日志生成成功: ${content}`);
            return content;
        } else {
            mainLogger.info("[角色日志] 没有重要事件需要记录");
            return null;
        }

    } catch (error) {
        mainLogger.error("[角色日志] API调用失败", error.message);
        toastr.error(`API调用失败: ${error.message}`, "角色日志");
        return null;
    }
}

/**
 * 获取最近的聊天记录
 * @param {number} messageCount - 获取最近几条消息
 * @returns {string} 格式化的聊天记录
 */
function getRecentMessages(messageCount = 10) {
    const context = window.SillyTavern.getContext();
    let messagesText = '';
    
    if (context.chat && context.chat.length > 0) {
        const recentMessages = context.chat.slice(-messageCount);
        recentMessages.forEach(msg => {
            const speaker = msg.is_user ? '{{user}}' : (msg.name || 'AI');
            messagesText += `${speaker}: ${msg.mes}\n`;
        });
    }
    
    return messagesText;
}

/**
 * 查找并更新角色的世界书条目
 * @param {string} characterName - 角色名称
 * @param {string} diaryEntry - 要追加的日志条目
 * @returns {Promise<boolean>} 是否成功
 */
async function appendToDiaryEntry(characterName, diaryEntry) {
    try {
        mainLogger.info(`[角色日志] 正在查找角色"${characterName}"的世界书条目...`);
        
        if (!TavernHelper || typeof TavernHelper.getCurrentCharPrimaryLorebook !== 'function') {
            throw new Error("TavernHelper API 不可用");
        }
        
        const lorebookName = await TavernHelper.getCurrentCharPrimaryLorebook();
        
        if (!lorebookName) {
            throw new Error("当前角色没有绑定世界书");
        }
        
        mainLogger.info(`[角色日志] 加载世界书: ${lorebookName}`);
        const bookData = await loadWorldInfo(lorebookName);
        
        if (!bookData || !bookData.entries) {
            throw new Error(`无法加载世界书"${lorebookName}"`);
        }
        
        // 查找匹配角色名称的条目
        let targetEntry = null;
        
        // 方法1: 通过comment查找（角色提取器创建的条目）
        targetEntry = Object.values(bookData.entries).find(
            entry => entry && entry.comment && entry.comment.includes(`角色信息: ${characterName}`)
        );
        
        // 方法2: 通过关键词查找
        if (!targetEntry) {
            targetEntry = Object.values(bookData.entries).find(
                entry => entry && entry.key && entry.key.includes(characterName)
            );
        }
        
        if (!targetEntry) {
            mainLogger.error(`[角色日志] 未找到角色"${characterName}"的世界书条目`);
            toastr.error(`未找到角色"${characterName}"的世界书条目，请先使用"角色信息提取器"创建`, "角色日志");
            return false;
        }
        
        mainLogger.info(`[角色日志] 找到目标条目 (uid: ${targetEntry.uid})`);
        
        // 追加日志到条目末尾
        const separator = '\n\n历史事件：\n';
        let content = targetEntry.content || '';
        
        // 如果还没有"历史事件"部分，添加标题
        if (!content.includes('历史事件：')) {
            content += separator;
        } else {
            content += '\n';
        }
        
        content += diaryEntry;
        targetEntry.content = content;
        
        // 保存世界书
        mainLogger.info(`[角色日志] 正在保存世界书...`);
        await saveWorldInfo(lorebookName, bookData, true);
        
        mainLogger.success(`[角色日志] 日志已成功追加到角色"${characterName}"的条目！`);
        toastr.success(`日志已追加到"${characterName}"的条目`, "角色日志");
        
        return true;
        
    } catch (error) {
        mainLogger.error("[角色日志] 追加日志失败", error.message);
        toastr.error(`追加日志失败: ${error.message}`, "角色日志");
        return false;
    }
}

/**
 * 主函数：为指定角色生成并追加日志
 * @param {string} characterName - 角色名称
 * @returns {Promise<boolean>} 是否成功
 */
export async function addCharacterDiary(characterName) {
    if (!characterName || characterName.trim() === '') {
        mainLogger.error("[角色日志] 角色名称不能为空");
        toastr.error("请输入角色名称", "角色日志");
        return false;
    }
    
    characterName = characterName.trim();
    mainLogger.info(`[角色日志] ========== 开始生成角色日志 ==========`);
    mainLogger.info(`[角色日志] 目标角色: ${characterName}`);
    
    try {
        // 1. 获取最近的聊天记录
        mainLogger.info("[角色日志] 步骤 1/3: 正在收集最近的对话...");
        const recentMessages = getRecentMessages(10);
        
        if (!recentMessages) {
            mainLogger.error("[角色日志] 无法获取聊天记录");
            toastr.error("无法获取聊天记录", "角色日志");
            return false;
        }
        
        mainLogger.info(`[角色日志] 对话收集完成，长度: ${recentMessages.length} 字符`);
        
        // 2. 调用AI生成日志条目
        mainLogger.info("[角色日志] 步骤 2/3: 正在调用AI生成日志...");
        const settings = getSettings();
        const prompt = buildDiaryPrompt(characterName, recentMessages);
        const diaryEntry = await callDiaryAPI(settings, prompt);
        
        if (!diaryEntry) {
            mainLogger.info("[角色日志] 本次对话没有需要记录的重要事件");
            return false;
        }
        
        // 3. 追加到世界书条目
        mainLogger.info("[角色日志] 步骤 3/3: 正在追加到世界书条目...");
        const success = await appendToDiaryEntry(characterName, diaryEntry);
        
        if (success) {
            mainLogger.success(`[角色日志] ========== 日志生成完成 ==========`);
            mainLogger.info(`[角色日志] 新增内容: ${diaryEntry}`);
        }
        
        return success;
        
    } catch (error) {
        mainLogger.error("[角色日志] 生成过程出错", error.message);
        toastr.error(`生成日志失败: ${error.message}`, "角色日志");
        return false;
    }
}
