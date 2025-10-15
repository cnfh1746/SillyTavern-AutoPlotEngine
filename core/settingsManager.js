/**
 * @file settingsManager.js
 * @description Manages loading and saving of settings for the Auto Plot Engine.
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { fetchModels, runPlotGenerationCycle } from './plot_engine.js';
import { clearAllLogs, mainLogger } from './logger.js';
import { extractCharacterInfo } from './character_extractor.js';

const extensionName = "SillyTavern-AutoPlotEngine";

// Default settings for the extension
const defaultSettings = {
    enabled: true,
    runMode: 'auto', // 'auto' or 'manual'
    triggerThreshold: 10,
    apiUrl: '',
    apiKey: '',
    model: 'gpt-4-turbo',
    maxTokens: 8000,
    temperature: 0.8,
    topP: 1.0,
    presencePenalty: 0.0,
    frequencyPenalty: 0.0,
    plotMasterPrompt: `你是一个专业的编剧，你的任务是分析我提供的所有信息，包括角色设定、世界观、现有聊天记录和旧的剧情大纲。
你需要根据这些信息，创作一个包含5个节点的、富有戏剧性的、符合逻辑的后续剧情大纲。
请确保新的剧情能延续旧大纲的风格，并将已经完成的旧节点标记为 [Resolved]。
你的输出必须严格遵循以下格式：
[Node 1: Unresolved] 剧情节点1的描述。
[Node 2: Unresolved] 剧情节点2的描述。
...`,
    // 世界书条目配置
    entryKeywords: ["剧情", "plot", "大纲", "故事", "情节"],
    entryPosition: 4,  // 0=before_char, 1=after_char, 2=top, 3=bottom, 4=@depth
    entryDepth: 1,     // 1-999
};

/**
 * Gets the current settings, merged with defaults.
 * @returns {object} The complete settings object.
 */
export function getSettings() {
    const savedSettings = extension_settings[extensionName] || {};
    return { ...defaultSettings, ...savedSettings };
}

/**
 * Saves the provided settings object.
 * @param {object} settings - The settings object to save.
 */
export function saveSettings(settings) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    Object.assign(extension_settings[extensionName], settings);
    saveSettingsDebounced();
    console.log(`[${extensionName}] Settings saved.`);
}

/**
 * Binds UI elements to load and save settings.
 */
export function initializeSettings() {
    const settings = getSettings();

    // Link UI elements to settings
    const mapping = {
        'ape_enabled': 'enabled',
        'ape_run_mode': 'runMode',
        'ape_trigger_threshold': 'triggerThreshold',
        'ape_api_url': 'apiUrl',
        'ape_api_key': 'apiKey',
        'ape_model': 'model',
        'ape_max_tokens': 'maxTokens',
        'ape_temperature': 'temperature',
        'ape_top_p': 'topP',
        'ape_presence_penalty': 'presencePenalty',
        'ape_frequency_penalty': 'frequencyPenalty',
        'ape_plot_master_prompt': 'plotMasterPrompt',
        'ape_entry_keywords': 'entryKeywords',
        'ape_entry_position': 'entryPosition',
        'ape_entry_depth': 'entryDepth',
    };

    // Function to save all settings from UI
    const saveAllFromUI = () => {
        const newSettings = {};
        for (const [elementId, key] of Object.entries(mapping)) {
            const element = document.getElementById(elementId);
            if (element) {
                if (element.type === 'checkbox') {
                    newSettings[key] = element.checked;
                } else if (key === 'entryKeywords') {
                    // 特殊处理：将逗号分隔的字符串转换为数组
                    newSettings[key] = element.value.split(',').map(k => k.trim()).filter(k => k);
                } else if (key === 'entryPosition' || key === 'entryDepth') {
                    // 转换为数字
                    newSettings[key] = parseInt(element.value) || defaultSettings[key];
                } else {
                    newSettings[key] = element.value;
                }
            }
        }
        saveSettings(newSettings);
    };

    // Load settings into UI and add event listeners
    for (const [elementId, key] of Object.entries(mapping)) {
        const element = document.getElementById(elementId);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = settings[key];
            } else if (key === 'entryKeywords') {
                // 特殊处理：将数组转换为逗号分隔的字符串
                element.value = Array.isArray(settings[key]) ? settings[key].join(',') : settings[key];
            } else {
                element.value = settings[key];
            }
            element.addEventListener('change', saveAllFromUI);
        }
    }

    // Add event listener for the fetch models button
    const fetchModelsButton = document.getElementById('ape_fetch_models_button');
    const modelSelect = document.getElementById('ape_model_select');
    const modelInput = document.getElementById('ape_model');

    if (fetchModelsButton && modelSelect && modelInput) {
        fetchModelsButton.addEventListener('click', async () => {
            const currentSettings = getSettings();
            const models = await fetchModels(currentSettings);
            modelSelect.innerHTML = '<option value="">-- 选择一个模型 --</option>';
            if (models && models.length > 0) {
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });
                toastr.success("模型列表已成功获取。");
            }
        });

        modelSelect.addEventListener('change', () => {
            if (modelSelect.value) {
                modelInput.value = modelSelect.value;
                modelInput.dispatchEvent(new Event('change'));
            }
        });
    }

    // Add logic for manual run button and mode switching
    const runModeSelect = document.getElementById('ape_run_mode');
    const manualRunBlock = document.getElementById('ape_manual_run_block');
    const manualRunButton = document.getElementById('ape_manual_run_button');

    const updateUIVisibility = () => {
        if (runModeSelect.value === 'manual') {
            manualRunBlock.style.display = 'block';
        } else {
            manualRunBlock.style.display = 'none';
        }
    };

    if (runModeSelect && manualRunBlock && manualRunButton) {
        runModeSelect.addEventListener('change', updateUIVisibility);
        manualRunButton.addEventListener('click', async () => {
            mainLogger.info("手动触发剧情生成");
            toastr.info("手动触发剧情生成...", "APE");
            manualRunButton.disabled = true;
            manualRunButton.textContent = "运行中...";
            try {
                await runPlotGenerationCycle();
            } finally {
                manualRunButton.disabled = false;
                manualRunButton.innerHTML = '<i class="fas fa-play-circle"></i> 立即生成剧情大纲';
            }
        });
        updateUIVisibility();
    }

    // Bind log panel buttons
    const clearLogButton = document.getElementById('ape_clear_log_button');
    const testButton = document.getElementById('ape_test_button');

    if (clearLogButton) {
        clearLogButton.addEventListener('click', () => {
            clearAllLogs();
            mainLogger.info("日志已清空");
        });
    }

    if (testButton) {
        testButton.addEventListener('click', async () => {
            mainLogger.info("========== 测试运行开始 ==========");
            toastr.info("开始测试运行...", "测试");
            testButton.disabled = true;
            try {
                await runPlotGenerationCycle();
            } finally {
                testButton.disabled = false;
            }
        });
    }

    // Bind character extractor button
    const characterNameInput = document.getElementById('ape_character_name');
    const extractCharacterButton = document.getElementById('ape_extract_character_button');

    if (extractCharacterButton && characterNameInput) {
        extractCharacterButton.addEventListener('click', async () => {
            const characterName = characterNameInput.value.trim();
            
            if (!characterName) {
                toastr.error("请输入角色名称", "角色提取器");
                return;
            }
            
            mainLogger.info(`开始提取角色信息: ${characterName}`);
            toastr.info(`正在提取 "${characterName}" 的信息...`, "角色提取器");
            
            extractCharacterButton.disabled = true;
            const originalHTML = extractCharacterButton.innerHTML;
            extractCharacterButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提取中...';
            
            try {
                const success = await extractCharacterInfo(characterName);
                
                if (success) {
                    toastr.success(`角色 "${characterName}" 的信息已成功提取并保存到世界书`, "角色提取器");
                    characterNameInput.value = ''; // 清空输入框
                } else {
                    toastr.error(`提取角色 "${characterName}" 的信息失败，请查看日志`, "角色提取器");
                }
            } catch (error) {
                toastr.error(`提取失败: ${error.message}`, "角色提取器");
                mainLogger.error(`[角色提取] 错误: ${error.message}`);
            } finally {
                extractCharacterButton.disabled = false;
                extractCharacterButton.innerHTML = originalHTML;
            }
        });

        // 支持按回车键提取
        characterNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                extractCharacterButton.click();
            }
        });
    }
    
    console.log(`[${extensionName}] Settings UI initialized.`);
}
