/**
 * @file index.js
 * @description Main entry point for the Auto Plot Engine extension.
 */

import { eventSource, event_types } from '/script.js';
import { createDrawer } from './core/drawer.js';
import { initializeSettings } from './core/settingsManager.js';
import { initLoggers, mainLogger } from './core/logger.js';
import { onMessageReceived, onChatChanged } from './core/events.js';

const extensionName = "SillyTavern-AutoPlotEngine";

/**
 * 等待DOM元素准备就绪
 * @param {string} selector - jQuery选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if ($(selector).length > 0) {
                clearInterval(checkInterval);
                resolve();
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                reject(new Error(`等待元素 ${selector} 超时`));
            }
        }, 50);
    });
}

/**
 * 初始化扩展（使用Promise链确保执行顺序）
 */
async function initialize() {
    try {
        console.log(`[${extensionName}] 开始初始化...`);

        // 1. 创建抽屉UI
        await createDrawer();
        console.log(`[${extensionName}] 抽屉UI已创建`);

        // 2. 等待日志面板DOM完全准备好
        await waitForElement('#ape_log_panel', 5000);
        console.log(`[${extensionName}] 日志面板已就绪`);

        // 3. 初始化日志系统
        initLoggers();
        mainLogger.success("AI组手初始化完成");
        mainLogger.info("日志系统已激活，所有操作将在此显示");

        // 4. 初始化设置
        await initializeSettings();
        mainLogger.info("设置已加载");

        // 5. 注册事件监听器
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        mainLogger.info("事件监听器已注册");

        console.log(`[${extensionName}] 初始化完成，等待消息...`);

    } catch (error) {
        console.error(`[${extensionName}] 初始化失败:`, error);
        // 显示用户友好的错误提示
        if (typeof toastr !== 'undefined') {
            toastr.error(`初始化失败: ${error.message}`, 'AI组手');
        }
    }
}

/**
 * 扩展入口点
 */
jQuery(async () => {
    console.log(`[${extensionName}] 等待SillyTavern准备就绪...`);

    // 等待扩展设置面板准备好
    const intervalId = setInterval(async () => {
        if ($('#extensions_settings').length > 0) {
            clearInterval(intervalId);
            await initialize();
        }
    }, 100);
});
