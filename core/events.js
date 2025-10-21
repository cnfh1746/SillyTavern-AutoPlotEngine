/**
 * @file events.js
 * @description 事件处理 - 监听消息并触发自动功能
 */

import { getContext } from '/scripts/extensions.js';
import { runPlotGenerationCycle } from './plot_engine.js';
import { addCharacterDiary, addMultipleCharacterDiaries } from './character_diary.js';
import { getSettings } from './settingsManager.js';
import { mainLogger } from './logger.js';

const extensionName = 'SillyTavern-AutoPlotEngine';

// 消息计数器
let plotMessageCount = 0;
let diaryMessageCount = 0;

// 防止重入的标志
let isProcessingPlot = false;
let isProcessingDiary = false;

/**
 * 在收到新消息时触发
 * @param {object} data - 事件数据
 */
export async function onMessageReceived(data) {
    const context = getContext();

    // 忽略非AI生成或正在等待用户输入的情况
    if ((data && data.source) || context.isWaitingForUserInput) {
        return;
    }

    const settings = getSettings();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        return;
    }

    const latestMessage = chat[chat.length - 1];

    // 只处理AI的消息
    if (latestMessage.is_user) {
        return;
    }

    // === 剧情大纲自动触发 ===
    if (settings.enabled && settings.runMode === 'auto') {
        // 防止重入
        if (isProcessingPlot) {
            mainLogger.debug('[主引擎] 剧情生成正在进行中，跳过本次触发');
            return;
        }
        
        plotMessageCount++;
        mainLogger.info(`[主引擎] 剧情消息计数: ${plotMessageCount}/${settings.triggerThreshold}`);

        if (plotMessageCount >= settings.triggerThreshold) {
            mainLogger.info('[主引擎] 达到剧情生成阈值，自动触发...');
            isProcessingPlot = true;
            
            try {
                await runPlotGenerationCycle();
                plotMessageCount = 0; // 重置计数器
                mainLogger.success('[主引擎] 自动剧情生成完成，计数器已重置');
            } catch (error) {
                mainLogger.error('[主引擎] 自动剧情生成失败', error.message);
            } finally {
                isProcessingPlot = false;
            }
        }
    }

    // === 角色日志自动触发 ===
    if (settings.diaryEnabled && settings.diaryRunMode === 'auto') {
        // 防止重入
        if (isProcessingDiary) {
            mainLogger.debug('[主引擎] 日志生成正在进行中，跳过本次触发');
            return;
        }
        
        diaryMessageCount++;
        mainLogger.info(`[主引擎] 日志消息计数: ${diaryMessageCount}/${settings.diaryTriggerThreshold}`);

        if (diaryMessageCount >= settings.diaryTriggerThreshold) {
            mainLogger.info('[主引擎] 达到日志生成阈值，自动触发...');
            isProcessingDiary = true;
            
            try {
                // 检查是否启用智能多角色识别
                if (settings.diarySmartDetection) {
                    mainLogger.info('[主引擎] 使用智能多角色识别模式');
                    await addMultipleCharacterDiaries();
                } else {
                    // 单角色模式
                    mainLogger.info('[主引擎] 使用单角色模式');
                    let targetCharacter = settings.diaryTargetCharacter;
                    
                    // 如果没有指定目标角色，使用当前对话角色
                    if (!targetCharacter || targetCharacter.trim() === '') {
                        targetCharacter = context.name2 || latestMessage.name;
                    }

                    if (targetCharacter) {
                        const silentMode = settings.silentMode || false;
                        await addCharacterDiary(targetCharacter, silentMode);
                    } else {
                        mainLogger.error('[主引擎] 无法确定目标角色，跳过日志生成');
                    }
                }
                
                diaryMessageCount = 0; // 重置计数器
                mainLogger.success('[主引擎] 自动日志生成完成，计数器已重置');
            } catch (error) {
                mainLogger.error('[主引擎] 自动日志生成失败', error.message);
                diaryMessageCount = 0; // 重置计数器避免一直卡住
            } finally {
                isProcessingDiary = false;
            }
        }
    }
}

/**
 * 在聊天内容改变时触发
 */
export function onChatChanged() {
    // 重置计数器（切换聊天时）
    plotMessageCount = 0;
    diaryMessageCount = 0;
    // 重置处理标志
    isProcessingPlot = false;
    isProcessingDiary = false;
    mainLogger.info('[主引擎] 聊天已切换，消息计数器和处理标志已重置');
}

/**
 * 手动重置计数器
 */
export function resetCounters() {
    plotMessageCount = 0;
    diaryMessageCount = 0;
    mainLogger.info('[主引擎] 消息计数器已手动重置');
}

/**
 * 获取当前计数器状态
 */
export function getCounterStatus() {
    return {
        plot: plotMessageCount,
        diary: diaryMessageCount,
        isProcessingPlot: isProcessingPlot,
        isProcessingDiary: isProcessingDiary
    };
}

/**
 * 清理资源（扩展卸载时调用）
 */
export function cleanup() {
    plotMessageCount = 0;
    diaryMessageCount = 0;
    isProcessingPlot = false;
    isProcessingDiary = false;
    mainLogger.info('[主引擎] 已清理所有资源');
}
