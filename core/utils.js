/**
 * @file utils.js
 * @description 通用工具函数
 */

import { mainLogger } from './logger.js';

/**
 * Token配置 - 根据不同场景设置合理的max_tokens
 */
export const MAX_TOKENS = {
    CHARACTER_LIST: 800,      // 角色列表识别（支持10-15个角色）
    DIARY_ENTRY: 1000,        // 日志条目生成
    INSTRUCTION_PARSE: 600,   // 指令解析
    DELETE_ANALYSIS: 1000,    // 删除分析
    TYPE_JUDGE: 200           // 类型判断（角色名 vs 指令）
};

/**
 * 统一的JSON解析函数（增强容错）
 * @param {string} content - AI返回的内容
 * @param {string} arrayField - 要提取的数组字段名（如'characters', 'uids'）
 * @returns {Object|null} 解析后的对象或null
 */
export function safeParseJSON(content, arrayField = null) {
    if (!content) {
        mainLogger.warn("[JSON解析] 内容为空");
        return null;
    }
    
    try {
        // 1. 清理markdown代码块
        let cleaned = content.trim()
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();
        
        // 2. 提取JSON对象
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            mainLogger.warn("[JSON解析] 未找到JSON对象");
            return null;
        }
        
        let jsonText = jsonMatch[0];
        
        // 3. 尝试直接解析（最常见的情况）
        try {
            const parsed = JSON.parse(jsonText);
            mainLogger.debug("[JSON解析] 标准解析成功");
            return parsed;
        } catch (parseError) {
            mainLogger.warn("[JSON解析] 标准解析失败，尝试容错提取");
            
            // 4. 容错处理：提取指定的数组字段
            if (arrayField) {
                return extractArrayField(jsonText, arrayField);
            }
            
            throw parseError;
        }
    } catch (error) {
        mainLogger.error(`[JSON解析] 完全失败: ${error.message}`);
        mainLogger.debug(`[JSON解析] 原始内容: ${content.substring(0, 300)}...`);
        return null;
    }
}

/**
 * 从不完整的JSON中提取数组字段
 * @param {string} jsonText - JSON文本
 * @param {string} arrayField - 数组字段名
 * @returns {Object|null}
 */
function extractArrayField(jsonText, arrayField) {
    try {
        // 匹配数组字段："characters": ["角色1", "角色2", ...]
        const arrayPattern = new RegExp(
            `"${arrayField}"\\s*:\\s*\\[([^\\]]*)\\]`,
            'i'
        );
        const arrayMatch = jsonText.match(arrayPattern);
        
        if (!arrayMatch) {
            mainLogger.warn(`[JSON解析] 未找到字段 "${arrayField}"`);
            return null;
        }
        
        // 提取数组内容中的所有字符串
        const arrayContent = arrayMatch[1];
        const stringMatches = arrayContent.match(/"([^"]+)"/g);
        
        if (!stringMatches || stringMatches.length === 0) {
            mainLogger.warn(`[JSON解析] 字段 "${arrayField}" 为空数组`);
            return { [arrayField]: [], reason: "空数组" };
        }
        
        // 清理引号
        const items = stringMatches.map(s => s.replace(/"/g, '').trim());
        
        mainLogger.success(`[JSON解析] 容错提取成功: ${items.length} 个项目`);
        return { 
            [arrayField]: items, 
            reason: "部分解析（容错模式）" 
        };
        
    } catch (error) {
        mainLogger.error(`[JSON解析] 数组提取失败: ${error.message}`);
        return null;
    }
}

/**
 * 简单的启发式判断：区分角色名和AI指令
 * @param {string} input - 用户输入
 * @returns {boolean} true表示可能是指令，false表示可能是角色名
 */
export function isLikelyInstruction(input) {
    if (!input || input.trim().length === 0) {
        return false;
    }
    
    const trimmed = input.trim();
    
    // 指令关键词（中文）
    const instructionKeywords = [
        '所有', '全部', '批量', '分析', '生成',
        '请', '帮', '为', '删除', '创建',
        '多个', '一起', '同时'
    ];
    
    // 1. 非常短的文本（<=4字）通常是角色名
    if (trimmed.length <= 4) {
        return false;
    }
    
    // 2. 短文本（5-6字）且不包含指令关键词，很可能是角色名
    if (trimmed.length <= 6) {
        const hasKeyword = instructionKeywords.some(k => trimmed.includes(k));
        return hasKeyword;
    }
    
    // 3. 统计包含的关键词数量
    const keywordCount = instructionKeywords.filter(k => trimmed.includes(k)).length;
    
    // 包含2个及以上关键词，很可能是指令
    if (keywordCount >= 2) {
        return true;
    }
    
    // 4. 长文本（>10字）且包含关键词，可能是指令
    if (trimmed.length > 10 && keywordCount > 0) {
        return true;
    }
    
    // 5. 默认按角色名处理
    return false;
}

/**
 * 调用AI的通用包装函数（减少重复代码）
 * @param {Object} options - 配置选项
 * @param {string} options.apiUrl - API地址
 * @param {string} options.apiKey - API密钥
 * @param {string} options.model - 模型名称
 * @param {string} options.prompt - 提示词
 * @param {number} options.maxTokens - 最大tokens
 * @param {number} options.temperature - 温度参数
 * @param {string} options.systemPrompt - 系统提示词（可选）
 * @returns {Promise<string|null>} AI响应内容
 */
export async function callAI({
    apiUrl,
    apiKey,
    model,
    prompt,
    maxTokens = 500,
    temperature = 0.7,
    systemPrompt = null
}) {
    try {
        // 确保API地址正确
        let url = apiUrl.trim().replace(/\/$/, '');
        if (!url.endsWith('/chat/completions')) {
            url += '/chat/completions';
        }
        
        // 构建消息
        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });
        
        const body = {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
        };
        
        mainLogger.debug(`[AI调用] 模型:${model}, maxTokens:${maxTokens}, temp:${temperature}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (!content) {
            mainLogger.warn("[AI调用] AI未返回内容");
            return null;
        }
        
        mainLogger.debug(`[AI调用] 响应长度: ${content.length} 字符`);
        return content;
        
    } catch (error) {
        mainLogger.error(`[AI调用] 失败: ${error.message}`);
        return null;
    }
}

/**
 * 延迟函数（用于批量操作时避免API请求过快）
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
