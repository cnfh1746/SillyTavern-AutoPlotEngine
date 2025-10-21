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
                    mainLogger.success("AI组手初始化完成");
                    mainLogger.info("日志系统已激活，所有操作将在此显示");
                }, 600);

                // 3. Initialize the settings UI
                setTimeout(initializeSettings, 500);

                // 4. Register event listeners
                eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
                eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

                console.log(`[${extensionName}] Initialization complete. Waiting for messages...`);

            } catch (error) {
                console.error(`[${extensionName}] Initialization failed:`, error);
            }
        }
    }, 100);
});
