/**
 * @file index.js
 * @description Main entry point for the Auto Plot Engine extension.
 */

import { eventSource, event_types } from '/script.js';
import { createDrawer } from './core/drawer.js';
import { initializeSettings, getSettings } from './core/settingsManager.js';
import { runPlotGenerationCycle } from './core/plot_engine.js';
import { initLoggers, mainLogger } from './core/logger.js';

const extensionName = "SillyTavern-AutoPlotEngine";
let messageCounter = 0;
let isProcessing = false;

/**
 * Handles the MESSAGE_RECEIVED event to trigger the plot generation cycle.
 */
async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled || isProcessing || settings.runMode !== 'auto') {
        return;
    }

    messageCounter++;
    mainLogger.debug(`消息计数: ${messageCounter}/${settings.triggerThreshold}`);

    if (messageCounter >= settings.triggerThreshold) {
        isProcessing = true;
        mainLogger.info(`已达到触发阈值 (${settings.triggerThreshold})，开始生成剧情`);
        
        try {
            await runPlotGenerationCycle();
        } catch (error) {
            mainLogger.error("剧情生成周期出错", error.message);
        } finally {
            messageCounter = 0;
            isProcessing = false;
            mainLogger.info("计数器已重置，等待下一次触发");
        }
    }
}

/**
 * Initializes the extension.
 */
jQuery(async () => {
    console.log(`[${extensionName}] Initializing...`);

    // Wait for the UI to be ready
    const intervalId = setInterval(async () => {
        if ($('#extensions_settings').length > 0) {
            clearInterval(intervalId);

            try {
                // 1. Create the drawer that will contain our settings panel
                await createDrawer();

                // 2. Initialize loggers (must be after drawer/panel is loaded)
                setTimeout(() => {
                    initLoggers();
                    mainLogger.success("自动剧情引擎初始化完成");
                    mainLogger.info("日志系统已激活，所有操作将在此显示");
                }, 600);

                // 3. Initialize the settings UI
                setTimeout(initializeSettings, 500);

                // 4. Register the main event listener
                eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

                console.log(`[${extensionName}] Initialization complete. Waiting for messages...`);

            } catch (error) {
                console.error(`[${extensionName}] Initialization failed:`, error);
            }
        }
    }, 100);
});
