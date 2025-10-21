/**
 * @file character_diary.js
 * @description 角色日志功能 - 自动记录角色经历并保存到世界书
 */

import { mainLogger } from './logger.js';
import { getSettings } from './settingsManager.js';
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry } from "/scripts/world-info.js";

const { toastr, TavernHelper } = window;

/**
 * 使用AI智能识别对话中的真实角色
 * @param {number} messageCount - 分析最近几条消息
 * @returns {Promise<Array<string>>} 角色名称数组
 */
async function detectCharactersFromMessages(messageCount = 20) {
    const context = window.SillyTavern.getContext();
    const settings = getSettings();
    
    if (!context.chat || context.chat.length === 0) {
        mainLogger.info(`[角色识别] 没有对话记录`);
        return [];
    }
    
    // 收集最近的消息
    const recentMessages = context.chat.slice(-messageCount);
    let messagesText = '';
    
    recentMessages.forEach(msg => {
        const speaker = msg.is_user ? '{{user}}' : (msg.name || 'AI');
        messagesText += `${speaker}: ${msg.mes}\n`;
    });
    
    // 完全让AI自己识别，不做任何预处理
    const aiPrompt = `请分析以下对话，识别出所有需要记录日志的角色。

对话内容：
${messagesText}

识别规则：
1. 识别对话中出现的真实角色名（如：炽霞、长离、秧秧等有独立人格的角色）
2. 排除以下内容：
   - {{user}}（这是用户角色，不需要记录）
   - 世界名、游戏名（如：鸣潮、原神、崩坏）
   - 系统名称、组织名、地点名
   - 其他非人物的名词

请按以下JSON格式输出：
{
  "characters": ["角色1", "角色2"],
  "reason": "识别依据的简短说明"
}

只输出JSON，不要有其他文字。`;

    try {
        let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
        if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl += '/chat/completions';
        }
        
        const body = {
            model: settings.model,
            messages: [
                { role: 'user', content: aiPrompt }
            ],
            temperature: 0.3,
            max_tokens: 1000,
            stream: false,
        };
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (!content) {
            throw new Error("AI未返回内容");
        }
        
        mainLogger.info(`[角色识别] AI原始响应: ${content.substring(0, 200)}...`);
        
        // 增强的JSON解析
        let result;
        try {
            // 1. 清理markdown标记
            let cleanContent = content.trim()
                .replace(/```json\s*/g, '')
                .replace(/```\s*/g, '')
                .trim();
            
            // 2. 提取JSON对象
            const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("未找到JSON对象");
            }
            
            let jsonText = jsonMatch[0];
            
            // 3. 修复不完整的JSON
            // 如果缺少结束的}或reason字段，尝试修复
            if (!jsonText.trim().endsWith('}')) {
                mainLogger.warn(`[角色识别] JSON不完整，尝试修复...`);
                jsonText += '}';
            }
            
            // 4. 尝试解析
            result = JSON.parse(jsonText);
            
            // 5. 如果characters字段缺失或不是数组，修复
            if (!result.characters || !Array.isArray(result.characters)) {
                // 尝试从文本中提取角色名（降级方案）
                mainLogger.warn(`[角色识别] JSON格式不正确，尝试提取角色名...`);
                
                // 查找 "characters": [...] 或 "characters":[ ... ]
                const arrayMatch = jsonText.match(/"characters"\s*:\s*\[(.*?)\]/);
                if (arrayMatch) {
                    const arrayContent = arrayMatch[1];
                    // 提取所有带引号的字符串
                    const names = arrayContent.match(/"([^"]+)"/g);
                    if (names) {
                        result = {
                            characters: names.map(n => n.replace(/"/g, '')),
                            reason: "从不完整响应中提取"
                        };
                    } else {
                        result = { characters: [], reason: "无法解析角色名" };
                    }
                } else {
                    result = { characters: [], reason: "JSON格式错误" };
                }
            }
            
        } catch (parseError) {
            mainLogger.error(`[角色识别] JSON解析失败: ${parseError.message}`);
            mainLogger.error(`[角色识别] 原始内容: ${content}`);
            return [];
        }
        
        if (!Array.isArray(result.characters)) {
            mainLogger.error(`[角色识别] characters字段不是数组`);
            return [];
        }
        
        mainLogger.info(`[角色识别] AI识别到 ${result.characters.length} 个角色: ${result.characters.join(', ')}`);
        mainLogger.info(`[角色识别] 识别依据: ${result.reason || '未提供'}`);
        
        return result.characters;
        
    } catch (error) {
        mainLogger.error(`[角色识别] AI识别失败: ${error.message}`);
        return [];
    }
}

/**
 * 生成角色日志的提示词
 * @param {string} characterName - 角色名称
 * @param {string} recentMessages - 最近的聊天记录
 * @returns {string} 提示词
 */
function buildDiaryPrompt(characterName, recentMessages) {
    const settings = getSettings();
    
    // 如果用户设置了自定义提示词，完全使用用户的提示词
    // 否则使用默认提示词
    const defaultPrompt = `分析以下对话，为角色"${characterName}"生成一条日志记录。

格式：YYYYMMDD 事件描述

对话内容：
${recentMessages}

请生成日志：`;

    const customPrompt = settings.diaryPrompt || defaultPrompt;
    
    // 替换变量
    return customPrompt
        .replace(/\$\{characterName\}/g, characterName)
        .replace(/\$\{recentMessages\}/g, recentMessages);
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
    
    // 从设置中获取参数，如果没有则使用默认值
    const body = {
        model: settings.model,
        messages: [
            { role: 'user', content: prompt }
        ],
        temperature: settings.temperature || 0.7,
        max_tokens: settings.maxTokens || 500,
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
        
        // 只要AI返回了任何内容就接受（包括"无"）
        if (content && content.length > 0) {
            mainLogger.success(`[角色日志] 日志生成成功: ${content}`);
            return content;
        } else {
            mainLogger.error("[角色日志] AI未返回任何内容");
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
 * 追加模式：追加到原角色条目
 */
async function appendToOriginalEntry(characterName, diaryEntry) {
    try {
        mainLogger.info(`[角色日志] [追加模式] 查找角色"${characterName}"的世界书条目...`);
        
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
        return true;
        
    } catch (error) {
        mainLogger.error("[角色日志] [追加模式] 失败", error.message);
        throw error;
    }
}

/**
 * 独立模式：创建独立的"角色名日志"条目
 */
async function createSeparateEntry(characterName, diaryEntry) {
    try {
        mainLogger.info(`[角色日志] [独立模式] 为角色"${characterName}"创建/更新日志条目...`);
        
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
        
        const entryTitle = `${characterName}日志`;
        
        // 查找是否已存在该日志条目
        let diaryEntryObj = Object.values(bookData.entries).find(
            entry => entry && entry.comment && entry.comment.includes(`角色日志: ${characterName}`)
        );
        
        if (diaryEntryObj) {
            // 更新现有条目
            mainLogger.info(`[角色日志] 找到现有日志条目 (uid: ${diaryEntryObj.uid})，正在追加...`);
            diaryEntryObj.content += '\n' + diaryEntry;
            
        } else {
            // 创建新条目
            mainLogger.info(`[角色日志] 未找到现有日志条目，正在创建新条目...`);
            
            // 获取最大uid
            const maxUid = Math.max(0, ...Object.values(bookData.entries).map(e => e.uid || 0));
            const newUid = maxUid + 1;
            
            diaryEntryObj = {
                uid: newUid,
                key: [characterName, characterName.substring(0, 2)], // 触发词：角色全名 + 简称
                keysecondary: [],
                comment: `角色日志: ${characterName}`,
                content: `# ${entryTitle}\n\n${diaryEntry}`,
                constant: false,
                selective: true,
                insertion_order: 100,
                enabled: true,
                position: 0, // before_char
                extensions: {
                    position: 0,
                    exclude_recursion: false,
                    display_index: newUid,
                    probability: 100,
                    useProbability: true,
                    depth: 4,
                    selectiveLogic: 0,
                    group: "",
                    group_override: false,
                    group_weight: 100,
                    prevent_recursion: false,
                    delay_until_recursion: false,
                    scan_depth: null,
                    match_whole_words: null,
                    use_group_scoring: false,
                    case_sensitive: null,
                    automation_id: "",
                    role: 0,
                    vectorized: false,
                    sticky: 0,
                    cooldown: 0,
                    delay: 0
                }
            };
            
            bookData.entries[newUid] = diaryEntryObj;
            mainLogger.info(`[角色日志] 新条目已创建 (uid: ${newUid})`);
        }
        
        // 保存世界书
        mainLogger.info(`[角色日志] 正在保存世界书...`);
        await saveWorldInfo(lorebookName, bookData, true);
        
        mainLogger.success(`[角色日志] 日志已成功保存到独立条目"${entryTitle}"！`);
        return true;
        
    } catch (error) {
        mainLogger.error("[角色日志] [独立模式] 失败", error.message);
        throw error;
    }
}

/**
 * AI指令模式：让AI分析并批量生成日志
 * @param {string} instruction - 用户的指令
 * @param {boolean} silentMode - 静默模式
 * @returns {Promise<boolean>} 是否成功
 */
async function processAIInstruction(instruction, silentMode = false) {
    mainLogger.info(`[AI指令模式] ========== 开始处理AI指令 ==========`);
    mainLogger.info(`[AI指令模式] 用户指令: ${instruction}`);
    
    try {
        const settings = getSettings();
        
        // 1. 获取对话内容
        const recentMessages = getRecentMessages(30); // 获取更多消息供AI分析
        
        // 2. 构建AI指令提示词
        const aiPrompt = `你是一个智能日志管理助手。用户给了你一个指令，你需要分析对话内容，并决定为哪些角色生成日志。

用户指令：
${instruction}

对话内容：
${recentMessages}

请分析对话内容，然后按以下JSON格式输出要生成日志的角色列表：
{
  "characters": ["角色1", "角色2", "角色3"],
  "reason": "为什么选择这些角色的简短说明"
}

注意：
1. 只输出JSON，不要有其他文字
2. 如果对话中没有合适的角色或内容，输出 {"characters": [], "reason": "原因"}
3. 角色名称必须准确匹配对话中出现的名字`;

        mainLogger.info(`[AI指令模式] 正在调用AI分析指令...`);
        
        // 调用API
        let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
        if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl += '/chat/completions';
        }
        
        const body = {
            model: settings.model,
            messages: [
                { role: 'system', content: '你是一个智能日志管理助手，擅长分析对话并识别需要记录日志的角色。只输出JSON格式的结果，不要添加任何解释。' },
                { role: 'user', content: aiPrompt }
            ],
            temperature: 0.3, // 降低温度提高准确性
            max_tokens: 2000, // 增加token限制
            stream: false,
        };
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (!content) {
            throw new Error("AI未返回任何内容");
        }
        
        mainLogger.info(`[AI指令模式] AI响应: ${content}`);
        
        // 3. 解析JSON（增强容错）
        let result;
        try {
            // 清理可能的markdown代码块标记
            let cleanContent = content.trim();
            
            // 移除markdown代码块标记
            cleanContent = cleanContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            // 提取JSON对象
            let jsonText = cleanContent;
            const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonText = jsonMatch[0];
            }
            
            // 尝试修复不完整的JSON
            // 如果JSON被截断（缺少reason字段的结束），尝试补全
            if (!jsonText.includes('"reason"') || !jsonText.trim().endsWith('}')) {
                mainLogger.warn(`[AI指令模式] JSON可能不完整，尝试修复...`);
                
                // 如果有characters数组但缺少reason，补全基本结构
                if (jsonText.includes('"characters"')) {
                    // 提取characters数组
                    const charMatch = jsonText.match(/"characters"\s*:\s*\[([^\]]*)\]/);
                    if (charMatch) {
                        const charsContent = charMatch[0];
                        jsonText = `{${charsContent},"reason":"AI响应被截断"}`;
                    }
                }
            }
            
            result = JSON.parse(jsonText);
            
        } catch (e) {
            mainLogger.error(`[AI指令模式] 原始响应: ${content}`);
            mainLogger.error(`[AI指令模式] JSON解析失败: ${e.message}`);
            throw new Error(`无法解析AI响应为JSON: ${e.message}`);
        }
        
        if (!result.characters || !Array.isArray(result.characters)) {
            throw new Error("AI响应格式不正确");
        }
        
        mainLogger.info(`[AI指令模式] AI识别到 ${result.characters.length} 个角色: ${result.characters.join(', ')}`);
        mainLogger.info(`[AI指令模式] 原因: ${result.reason}`);
        
        if (result.characters.length === 0) {
            mainLogger.info(`[AI指令模式] 没有需要生成日志的角色`);
            if (!silentMode) {
                toastr.info(`AI分析结果：${result.reason}`, "AI指令模式", { timeOut: 5000 });
            }
            return false;
        }
        
        // 4. 批量生成日志
        if (!silentMode) {
            toastr.info(`AI识别到 ${result.characters.length} 个角色，开始生成日志...`, "AI指令模式", { timeOut: 3000 });
        }
        
        const batchResults = {
            total: result.characters.length,
            success: 0,
            failed: 0,
            skipped: 0
        };
        
        for (const characterName of result.characters) {
            try {
                mainLogger.info(`[AI指令模式] [${batchResults.success + batchResults.failed + batchResults.skipped + 1}/${batchResults.total}] 处理角色: ${characterName}`);
                
                const success = await addCharacterDiary(characterName, true);
                
                if (success) {
                    batchResults.success++;
                    mainLogger.success(`[AI指令模式] ✓ ${characterName} - 成功`);
                } else {
                    batchResults.skipped++;
                    mainLogger.info(`[AI指令模式] ○ ${characterName} - 跳过`);
                }
                
                // 延迟避免API请求过快
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                batchResults.failed++;
                mainLogger.error(`[AI指令模式] ✗ ${characterName} - 失败: ${error.message}`);
            }
        }
        
        // 5. 输出结果
        mainLogger.success(`[AI指令模式] ========== 批量生成完成 ==========`);
        mainLogger.info(`[AI指令模式] 总计: ${batchResults.total} | 成功: ${batchResults.success} | 跳过: ${batchResults.skipped} | 失败: ${batchResults.failed}`);
        
        if (!silentMode) {
            toastr.success(
                `AI指令执行完成！\n成功: ${batchResults.success} | 跳过: ${batchResults.skipped} | 失败: ${batchResults.failed}`,
                "AI指令模式",
                { timeOut: 5000 }
            );
        }
        
        return batchResults.success > 0;
        
    } catch (error) {
        mainLogger.error("[AI指令模式] 处理失败", error.message);
        if (!silentMode) {
            toastr.error(`AI指令处理失败: ${error.message}`, "AI指令模式");
        }
        return false;
    }
}

/**
 * 主函数：为指定角色生成并保存日志（支持AI指令模式）
 * @param {string} characterName - 角色名称或AI指令
 * @param {boolean} silentMode - 静默模式（不显示toastr通知）
 * @returns {Promise<boolean>} 是否成功
 */
export async function addCharacterDiary(userInput, silentMode = false) {
    if (!userInput || userInput.trim() === '') {
        mainLogger.error("[角色日志] 输入不能为空");
        if (!silentMode) toastr.error("请输入角色名称或AI指令", "角色日志");
        return false;
    }
    
    userInput = userInput.trim();
    
    // 让AI判断用户输入的是"角色名"还是"指令"
    const settings = getSettings();
    
    try {
        const judgePrompt = `你是一个智能助手。请判断用户输入的是"角色名称"还是"AI指令"。

用户输入：
${userInput}

判断规则：
- 如果是简短的名字（如：炽霞、长离、秧秧），判断为"角色名称"
- 如果是完整的句子或请求（如：请分析对话、为所有角色生成日志），判断为"AI指令"

请按以下JSON格式输出：
{
  "type": "character_name" 或 "ai_instruction",
  "reason": "判断理由"
}

只输出JSON，不要有其他文字。`;

        let apiUrl = settings.apiUrl.trim().replace(/\/$/, '');
        if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl += '/chat/completions';
        }
        
        const body = {
            model: settings.model,
            messages: [
                { role: 'user', content: judgePrompt }
            ],
            temperature: 0.1,
            max_tokens: 200,
            stream: false,
        };
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim();
            
            if (content) {
                let cleanContent = content.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
                const jsonText = jsonMatch ? jsonMatch[0] : cleanContent;
                const result = JSON.parse(jsonText);
                
                mainLogger.info(`[角色日志] AI判断: ${result.type} - ${result.reason}`);
                
                if (result.type === 'ai_instruction') {
                    mainLogger.info(`[角色日志] 切换到AI指令处理模式`);
                    return await processAIInstruction(userInput, silentMode);
                }
            }
        }
    } catch (error) {
        mainLogger.warn(`[角色日志] AI判断失败，按角色名称处理: ${error.message}`);
    }
    
    // 默认按角色名称处理
    const characterName = userInput;
    mainLogger.info(`[角色日志] ========== 开始生成角色日志 ==========`);
    mainLogger.info(`[角色日志] 目标角色: ${characterName}`);
    
    try {
        const settings = getSettings();
        
        // 检查日志功能是否启用
        if (!settings.diaryEnabled) {
            mainLogger.info("[角色日志] 日志功能已禁用");
            return false;
        }
        
        // 1. 获取最近的聊天记录
        mainLogger.info("[角色日志] 步骤 1/3: 正在收集最近的对话...");
        const recentMessages = getRecentMessages(10);
        
        if (!recentMessages) {
            mainLogger.error("[角色日志] 无法获取聊天记录");
            if (!silentMode) toastr.error("无法获取聊天记录", "角色日志");
            return false;
        }
        
        mainLogger.info(`[角色日志] 对话收集完成，长度: ${recentMessages.length} 字符`);
        
        // 2. 调用AI生成日志条目
        mainLogger.info("[角色日志] 步骤 2/3: 正在调用AI生成日志...");
        const prompt = buildDiaryPrompt(characterName, recentMessages);
        const diaryEntry = await callDiaryAPI(settings, prompt);
        
        if (!diaryEntry) {
            mainLogger.info("[角色日志] 本次对话没有需要记录的重要事件");
            return false;
        }
        
        // 3. 根据存储模式保存日志
        mainLogger.info("[角色日志] 步骤 3/3: 正在保存日志...");
        const storageMode = settings.diaryStorageMode || 'append';
        mainLogger.info(`[角色日志] 存储模式: ${storageMode === 'append' ? '追加到原条目' : '创建独立条目'}`);
        
        let success = false;
        if (storageMode === 'separate') {
            success = await createSeparateEntry(characterName, diaryEntry);
        } else {
            success = await appendToOriginalEntry(characterName, diaryEntry);
        }
        
        if (success) {
            mainLogger.success(`[角色日志] ========== 日志生成完成 ==========`);
            mainLogger.info(`[角色日志] 新增内容: ${diaryEntry}`);
            if (!silentMode) toastr.success(`角色"${characterName}"的日志已成功保存`, "角色日志");
        }
        
        return success;
        
    } catch (error) {
        mainLogger.error("[角色日志] 生成过程出错", error.message);
        if (!silentMode) toastr.error(`生成日志失败: ${error.message}`, "角色日志");
        return false;
    }
}

/**
 * 批量生成多个角色的日志（智能多角色模式）
 * @returns {Promise<Object>} 返回生成结果统计
 */
export async function addMultipleCharacterDiaries() {
    const settings = getSettings();
    
    // 检查是否启用智能识别
    if (!settings.diarySmartDetection) {
        mainLogger.info("[批量日志] 智能多角色识别未启用，使用单角色模式");
        return null;
    }
    
    mainLogger.info("[批量日志] ========== 开始智能多角色日志生成 ==========");
    
    // 1. 检测所有角色（现在是异步的）
    const characters = await detectCharactersFromMessages(20);
    
    if (characters.length === 0) {
        mainLogger.info("[批量日志] 未检测到任何角色");
        return { total: 0, success: 0, failed: 0, skipped: 0 };
    }
    
    mainLogger.info(`[批量日志] 准备为 ${characters.length} 个角色生成日志`);
    
    // 2. 静默模式配置
    const silentMode = settings.silentMode || false;
    
    if (!silentMode) {
        toastr.info(`正在为 ${characters.length} 个角色生成日志，请稍候...`, "批量日志", { timeOut: 3000 });
    }
    
    // 3. 依次为每个角色生成日志
    const results = {
        total: characters.length,
        success: 0,
        failed: 0,
        skipped: 0,
        details: []
    };
    
    for (const characterName of characters) {
        try {
            mainLogger.info(`[批量日志] [${results.success + results.failed + results.skipped + 1}/${characters.length}] 处理角色: ${characterName}`);
            
            const success = await addCharacterDiary(characterName, true); // 强制静默模式
            
            if (success) {
                results.success++;
                results.details.push({ character: characterName, status: 'success' });
                mainLogger.success(`[批量日志] ✓ ${characterName} - 成功`);
            } else {
                results.skipped++;
                results.details.push({ character: characterName, status: 'skipped' });
                mainLogger.info(`[批量日志] ○ ${characterName} - 跳过（无重要事件）`);
            }
            
            // 避免API请求过快，添加短暂延迟
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            results.failed++;
            results.details.push({ character: characterName, status: 'failed', error: error.message });
            mainLogger.error(`[批量日志] ✗ ${characterName} - 失败: ${error.message}`);
        }
    }
    
    // 4. 输出汇总
    mainLogger.success(`[批量日志] ========== 批量生成完成 ==========`);
    mainLogger.info(`[批量日志] 总计: ${results.total} | 成功: ${results.success} | 跳过: ${results.skipped} | 失败: ${results.failed}`);
    
    if (!silentMode) {
        toastr.success(
            `批量日志生成完成！\n成功: ${results.success} | 跳过: ${results.skipped} | 失败: ${results.failed}`,
            "批量日志",
            { timeOut: 5000 }
        );
    }
    
    return results;
}
