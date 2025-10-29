/**
 * @file character_diary.js
 * @description 角色日志功能 - 自动记录角色经历并保存到世界书
 */

import { mainLogger } from './logger.js';
import { getSettings } from './settingsManager.js';
import { getMemoryTableData } from './information_aggregator.js';
import { safeParseJSON, callAI, isLikelyInstruction, MAX_TOKENS, delay } from './utils.js';
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry } from "/scripts/world-info.js";

const { toastr, TavernHelper } = window;

// 全局停止标志（移除isDiaryProcessing，由events.js统一管理）
let shouldStopDiary = false;

/**
 * 停止日志生成
 */
export function stopDiaryGeneration() {
    shouldStopDiary = true;
    mainLogger.warn("[角色日志] 用户请求停止日志生成");
}

/**
 * 检查是否应该停止
 */
function checkShouldStop() {
    if (shouldStopDiary) {
        mainLogger.info("[角色日志] 检测到停止信号，终止操作");
        return true;
    }
    return false;
}

/**
 * 使用AI智能识别对话中的真实角色
 * @returns {Promise<Array<string>>} 角色名称数组
 */
async function detectCharactersFromMessages() {
    const context = window.SillyTavern.getContext();
    const settings = getSettings();
    
    if (!context.chat || context.chat.length === 0) {
        mainLogger.info(`[角色识别] 没有对话记录`);
        return [];
    }
    
    // 获取用户名称（用于排除）
    const userName = context.name1 || 'user';
    mainLogger.info(`[角色识别] 当前用户名: ${userName}`);
    
    // 使用设置中的消息数量（默认为1，即只读最新的AI消息）
    const messageCount = settings.diaryMessageCount || 1;
    mainLogger.info(`[角色识别] 分析最近 ${messageCount} 条AI消息`);
    
    // 只收集AI消息（不包括用户消息）
    const aiMessages = context.chat.filter(msg => !msg.is_user);
    const recentAIMessages = aiMessages.slice(-messageCount);
    
    if (recentAIMessages.length === 0) {
        mainLogger.info(`[角色识别] 没有AI消息`);
        return [];
    }
    
    let messagesText = '';
    recentAIMessages.forEach(msg => {
        const speaker = msg.name || 'AI';
        messagesText += `${speaker}: ${msg.mes}\n`;
    });
    
    mainLogger.info(`[角色识别] 收集到 ${recentAIMessages.length} 条AI消息，总长度: ${messagesText.length} 字符`);
    
    // 精确识别：只识别正在现场参与对话和事件的角色
    const aiPrompt = `请分析以下对话内容，识别出【正在现场、正在参与当前事件】的角色。

对话内容：
${messagesText}

🎯 核心识别标准：
只有同时满足以下条件的角色才需要识别：
1. 在对话正文中有实际出现（有台词、动作、描写）
2. 正在参与当前场景的事件（不是被提及的远方角色）
3. 是有独立人格的NPC角色（不是玩家、不是地名、不是组织名）

✅ 应该识别的例子：
- "长离发出了一声极轻的、带着一丝不屑的鼻音" → 识别"长离"
- "阿布摇着尾巴跑来" → 识别"阿布"
- "秧秧笑着说道" → 识别"秧秧"

❌ 不应该识别的例子：
- "${userName}"（这是玩家角色，绝对不要识别）
- "{{user}}"（这是玩家变量，绝对不要识别）
- "📱当前章节（登场人物：今汐/辛夷）" → 这是UI，不识别
- "[节点05] 在虹镇见到辛夷" → 这是未来剧情，不识别
- "今汐正冒险解救岁主'角'" → 这只是提及，如果今汐和岁主没在正文出现，不识别
- "残星会成员弗洛洛在暗中观察" → 如果只是旁白提及，没有实际对话/动作，不识别

🚫 必须排除（非常重要）：
- "${userName}"（当前玩家名，绝对不要识别）
- {{user}}（玩家变量）
- 仅在状态栏/表格/时间线中提到的角色
- 仅被提及但不在现场的角色
- 世界名、游戏名、地名、组织名

请严格按照以上标准，输出JSON格式：
{
  "characters": ["角色1", "角色2"],
  "reason": "简短说明这些角色为什么在场"
}

只输出JSON，不要有其他文字。`;

    try {
        // 使用统一的AI调用函数
        const content = await callAI({
            apiUrl: settings.apiUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            prompt: aiPrompt,
            maxTokens: MAX_TOKENS.CHARACTER_LIST,
            temperature: 0.3
        });
        
        if (!content) {
            throw new Error("AI未返回内容");
        }
        
        mainLogger.info(`[角色识别] AI原始响应: ${content.substring(0, 200)}...`);
        
        // 使用统一的JSON解析函数
        const result = safeParseJSON(content, 'characters');
        
        if (!result || !result.characters) {
            mainLogger.warn(`[角色识别] 无法解析角色列表`);
            return [];
        }
        
        if (!Array.isArray(result.characters)) {
            mainLogger.error(`[角色识别] characters字段不是数组`);
            return [];
        }
        
        mainLogger.info(`[角色识别] AI识别到 ${result.characters.length} 个角色: ${result.characters.join(', ')}`);
        mainLogger.info(`[角色识别] 识别依据: ${result.reason || '未提供'}`);
        
        // 过滤掉用户名（双重保险）
        const filteredCharacters = result.characters.filter(char => {
            const isUser = char === userName || char === '{{user}}' || char.toLowerCase() === 'user';
            if (isUser) {
                mainLogger.info(`[角色识别] 过滤掉用户角色: ${char}`);
            }
            return !isUser;
        });
        
        mainLogger.info(`[角色识别] 过滤后剩余 ${filteredCharacters.length} 个角色: ${filteredCharacters.join(', ')}`);
        
        return filteredCharacters;
        
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
    
    // 获取表格数据
    const tableData = getMemoryTableData();
    
    // 如果用户设置了自定义提示词，完全使用用户的提示词
    // 否则使用默认提示词
    const defaultPrompt = `分析以下对话，为角色"${characterName}"生成一条日志记录。

格式：YYYYMMDD 事件描述

对话内容：
${recentMessages}

请生成日志：`;

    const customPrompt = settings.diaryPrompt || defaultPrompt;
    
    // 构建最终提示词，添加格式约束
    let finalPrompt = customPrompt
        .replace(/\$\{characterName\}/g, characterName)
        .replace(/\$\{recentMessages\}/g, recentMessages)
        .replace(/\$\{tableData\}/g, tableData);
    
    // 在提示词末尾添加格式约束（不修改用户自定义部分）
    finalPrompt += `\n\n<format_rules>
重要：请严格按照用户指定的格式输出，不要添加任何开场白（如"好的"、"这是"等）或其他无关内容。
如果确实没有重要事件需要记录，只输出：无
</format_rules>`;
    
    return finalPrompt;
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
            max_tokens: 20000,
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
                
                // 直接调用内部函数，绕过 isDiaryProcessing 检查
                const success = await generateSingleDiary(characterName, true);
                
                if (success) {
                    batchResults.success++;
                    mainLogger.success(`[AI指令模式] ✓ ${characterName} - 成功`);
                } else {
                    batchResults.skipped++;
                    mainLogger.info(`[AI指令模式] ○ ${characterName} - 跳过`);
                }
                
                // 使用统一的延迟函数
                await delay(1000);
                
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
 * 内部函数：直接生成单个角色日志（不检查处理标志）
 * @param {string} characterName - 角色名称
 * @param {boolean} silentMode - 静默模式
 * @returns {Promise<boolean>} 是否成功
 */
async function generateSingleDiary(characterName, silentMode = false) {
    mainLogger.info(`[角色日志] ========== 开始生成角色日志 ==========`);
    mainLogger.info(`[角色日志] 目标角色: ${characterName}`);
    
    const settings = getSettings();
    
    try {
        // 检查日志功能是否启用
        if (!settings.diaryEnabled) {
            mainLogger.info("[角色日志] 日志功能已禁用");
            return false;
        }
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
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
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
            return false;
        }
        
        // 2. 调用AI生成日志条目
        mainLogger.info("[角色日志] 步骤 2/3: 正在调用AI生成日志...");
        const prompt = buildDiaryPrompt(characterName, recentMessages);
        let diaryEntry = await callDiaryAPI(settings, prompt);
        
        if (!diaryEntry) {
            mainLogger.info("[角色日志] 本次对话没有需要记录的重要事件");
            return false;
        }
        
        // 替换 {{user}} 为实际用户名
        const context = window.SillyTavern.getContext();
        const userName = context.name1 || 'user';
        if (diaryEntry.includes('{{user}}')) {
            const originalEntry = diaryEntry;
            diaryEntry = diaryEntry.replace(/\{\{user\}\}/g, userName);
            mainLogger.info(`[角色日志] 已将日志中的 {{user}} 替换为 ${userName}`);
            mainLogger.debug(`[角色日志] 替换前: ${originalEntry}`);
            mainLogger.debug(`[角色日志] 替换后: ${diaryEntry}`);
        }
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
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
    
    // 重置停止标志
    shouldStopDiary = false;
    
    try {
        userInput = userInput.trim();
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
            return false;
        }
        
        // 使用启发式判断替代AI调用（更快、更省成本）
        if (isLikelyInstruction(userInput)) {
            mainLogger.info(`[角色日志] 启发式判断: 这是一个AI指令`);
            
            // 检查停止信号
            if (checkShouldStop()) {
                if (!silentMode) toastr.info("日志生成已停止", "角色日志");
                return false;
            }
            
            return await processAIInstruction(userInput, silentMode);
        }
        
        mainLogger.info(`[角色日志] 启发式判断: 这是一个角色名称`);
    } catch (error) {
        mainLogger.warn(`[角色日志] 判断失败，按角色名称处理: ${error.message}`);
    }
    
    // 默认按角色名称处理
    const characterName = userInput;
    const settings = getSettings(); // 重新获取settings
    mainLogger.info(`[角色日志] ========== 开始生成角色日志 ==========`);
    mainLogger.info(`[角色日志] 目标角色: ${characterName}`);
    
    try {
        // 检查日志功能是否启用
        if (!settings.diaryEnabled) {
            mainLogger.info("[角色日志] 日志功能已禁用");
            return false;
        }
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
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
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
            return false;
        }
        
        // 2. 调用AI生成日志条目
        mainLogger.info("[角色日志] 步骤 2/3: 正在调用AI生成日志...");
        const prompt = buildDiaryPrompt(characterName, recentMessages);
        let diaryEntry = await callDiaryAPI(settings, prompt);
        
        if (!diaryEntry) {
            mainLogger.info("[角色日志] 本次对话没有需要记录的重要事件");
            return false;
        }
        
        // 替换 {{user}} 为实际用户名
        const context = window.SillyTavern.getContext();
        const userName = context.name1 || 'user';
        if (diaryEntry.includes('{{user}}')) {
            const originalEntry = diaryEntry;
            diaryEntry = diaryEntry.replace(/\{\{user\}\}/g, userName);
            mainLogger.info(`[角色日志] 已将日志中的 {{user}} 替换为 ${userName}`);
            mainLogger.debug(`[角色日志] 替换前: ${originalEntry}`);
            mainLogger.debug(`[角色日志] 替换后: ${diaryEntry}`);
        }
        
        // 检查停止信号
        if (checkShouldStop()) {
            if (!silentMode) toastr.info("日志生成已停止", "角色日志");
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
    } finally {
        // 重置停止标志
        shouldStopDiary = false;
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
