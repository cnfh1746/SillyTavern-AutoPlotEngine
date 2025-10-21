/**
 * @file settingsManager.js
 * @description Manages loading and saving of settings for the Auto Plot Engine.
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { fetchModels, runPlotGenerationCycle } from './plot_engine.js';
import { clearAllLogs, mainLogger } from './logger.js';
import { extractCharacterInfo } from './character_extractor.js';
import { addCharacterDiary } from './character_diary.js';
import { deleteWorldBookEntries, deleteAllDiaryEntries } from './worldbook_manager.js';
import { hideModal } from './drawer.js';

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
    // 角色日志提示词
    diaryPrompt: `你是一个专业的事件记录员。请分析下面的对话内容，为角色"\${characterName}"生成一条精炼的历史事件记录。

重要事件包括但不限于：
- 关系进展（表白、亲密接触、确立关系等）
- 重要对话或承诺
- 收到礼物或给予礼物
- 情感变化（生气、和解、感动等）
- 做出重要决定
- 遇到特殊的人或事

要求：
1. 使用第一人称（"我"）的视角
2. 格式：YYYYMMDD 事件描述（10-30字）
3. 只输出一条最重要的事件
4. 如果确实没有任何值得记录的事件，才输出"无"

示例：
20250607 {{user}}送了我一个项链作为生日礼物
20250608 我和{{user}}确立了恋爱关系
20250609 第一次和{{user}}发生了亲密关系

对话内容：
\${recentMessages}

请生成一条事件记录：`,
    // 角色日志配置
    diaryEnabled: false,                    // 是否启用角色日志功能
    diaryRunMode: 'manual',                 // 'auto' or 'manual'
    diaryTriggerThreshold: 15,              // 自动触发阈值（消息数）
    diaryStorageMode: 'append',             // 'append'（追加到原条目）or 'separate'（创建新条目）
    diaryTargetCharacter: '',               // 要记录日志的角色名称（自动模式用）
    diarySmartDetection: true,              // 智能识别多角色模式
    diaryMessageCount: 1,                   // 分析最近N条AI消息
    silentMode: false,                      // 静默模式（关闭所有toastr通知）
};

/**
 * 验证数字输入
 * @param {*} value - 要验证的值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @param {number} defaultValue - 默认值
 * @returns {number} 验证后的数字
 */
function validateNumber(value, min, max, defaultValue) {
    const num = parseFloat(value);
    
    if (isNaN(num)) {
        mainLogger.warn(`无效的数字输入: ${value}，使用默认值 ${defaultValue}`);
        return defaultValue;
    }
    
    if (num < min) {
        mainLogger.warn(`数字 ${num} 小于最小值 ${min}，使用最小值`);
        return min;
    }
    
    if (num > max) {
        mainLogger.warn(`数字 ${num} 大于最大值 ${max}，使用最大值`);
        return max;
    }
    
    return num;
}

/**
 * 验证字符串输入
 * @param {*} value - 要验证的值
 * @param {number} maxLength - 最大长度
 * @param {string} defaultValue - 默认值
 * @returns {string} 验证后的字符串
 */
function validateString(value, maxLength, defaultValue = '') {
    if (typeof value !== 'string') {
        mainLogger.warn(`无效的字符串输入，使用默认值`);
        return defaultValue;
    }
    
    if (value.length > maxLength) {
        mainLogger.warn(`字符串长度 ${value.length} 超过最大值 ${maxLength}，将截断`);
        return value.substring(0, maxLength);
    }
    
    return value;
}

/**
 * 验证设置对象
 * @param {Object} settings - 要验证的设置
 * @returns {Object} 验证后的设置
 */
function validateSettings(settings) {
    const validated = { ...settings };
    
    // 验证数字类型的设置
    validated.triggerThreshold = validateNumber(settings.triggerThreshold, 1, 1000, 5);
    validated.maxTokens = validateNumber(settings.maxTokens, 100, 65536, 4000);
    validated.temperature = validateNumber(settings.temperature, 0, 2, 0.7);
    validated.topP = validateNumber(settings.topP, 0, 1, 1.0);
    validated.presencePenalty = validateNumber(settings.presencePenalty, -2, 2, 0);
    validated.frequencyPenalty = validateNumber(settings.frequencyPenalty, -2, 2, 0);
    validated.entryPosition = validateNumber(settings.entryPosition, 0, 10, 4);
    validated.entryDepth = validateNumber(settings.entryDepth, 0, 10, 1);
    validated.diaryTriggerThreshold = validateNumber(settings.diaryTriggerThreshold, 1, 1000, 3);
    validated.diaryMaxTokens = validateNumber(settings.diaryMaxTokens, 100, 65536, 2000);
    validated.diaryTemperature = validateNumber(settings.diaryTemperature, 0, 2, 0.7);
    
    // 验证字符串类型的设置
    validated.apiUrl = validateString(settings.apiUrl, 500, '');
    validated.apiKey = validateString(settings.apiKey, 500, '');
    validated.model = validateString(settings.model, 200, '');
    validated.plotMasterPrompt = validateString(settings.plotMasterPrompt, 50000, defaultSettings.plotMasterPrompt);
    validated.diaryTargetCharacter = validateString(settings.diaryTargetCharacter, 200, '');
    validated.diaryMasterPrompt = validateString(settings.diaryMasterPrompt, 50000, defaultSettings.diaryMasterPrompt);
    
    // 验证数组
    if (!Array.isArray(validated.entryKeywords)) {
        mainLogger.warn('entryKeywords 不是数组，使用默认值');
        validated.entryKeywords = defaultSettings.entryKeywords;
    }
    
    // 验证布尔值
    validated.enabled = Boolean(settings.enabled);
    validated.diaryEnabled = Boolean(settings.diaryEnabled);
    validated.silentMode = Boolean(settings.silentMode);
    validated.diarySmartDetection = Boolean(settings.diarySmartDetection);
    
    // 验证枚举值
    if (!['auto', 'manual'].includes(validated.runMode)) {
        mainLogger.warn(`无效的runMode: ${validated.runMode}，使用默认值`);
        validated.runMode = defaultSettings.runMode;
    }
    
    if (!['auto', 'manual'].includes(validated.diaryRunMode)) {
        mainLogger.warn(`无效的diaryRunMode: ${validated.diaryRunMode}，使用默认值`);
        validated.diaryRunMode = defaultSettings.diaryRunMode;
    }
    
    return validated;
}

/**
 * Saves the current settings to extension settings.
 */
export function saveSettings() {
    // 验证设置
    currentSettings = validateSettings(currentSettings);
    
    extensionSettings[extensionName] = currentSettings;
    saveSettingsDebounced();
    mainLogger.info("设置已保存");
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
        // 角色日志相关
        'ape_diary_enabled': 'diaryEnabled',
        'ape_diary_run_mode': 'diaryRunMode',
        'ape_diary_trigger_threshold': 'diaryTriggerThreshold',
        'ape_diary_storage_mode': 'diaryStorageMode',
        'ape_diary_target_character': 'diaryTargetCharacter',
        'ape_diary_smart_detection': 'diarySmartDetection',
        'ape_diary_message_count': 'diaryMessageCount',
        'ape_silent_mode': 'silentMode',
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

    // Add logic for plot manual run button and mode switching
    const runModeSelect = document.getElementById('ape_run_mode');
    const plotAutoSettings = document.getElementById('ape_plot_auto_settings');
    const manualRunBlock = document.getElementById('ape_manual_run_block');
    const manualRunButton = document.getElementById('ape_manual_run_button');

    const updatePlotUIVisibility = () => {
        if (runModeSelect && plotAutoSettings && manualRunBlock) {
            if (runModeSelect.value === 'manual') {
                plotAutoSettings.style.display = 'none';
                manualRunBlock.style.display = 'block';
            } else {
                plotAutoSettings.style.display = 'block';
                manualRunBlock.style.display = 'none';
            }
        }
    };

    if (runModeSelect && manualRunBlock && manualRunButton) {
        runModeSelect.addEventListener('change', updatePlotUIVisibility);
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
        updatePlotUIVisibility();
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
    
    // Bind character diary settings
    const diaryRunModeSelect = document.getElementById('ape_diary_run_mode');
    const diaryAutoSettings = document.getElementById('ape_diary_auto_settings');
    const diaryTargetChar = document.getElementById('ape_diary_target_char');
    const diaryManualBlock = document.getElementById('ape_diary_manual_block');
    
    const updateDiaryUIVisibility = () => {
        if (diaryRunModeSelect && diaryAutoSettings && diaryTargetChar && diaryManualBlock) {
            if (diaryRunModeSelect.value === 'manual') {
                diaryAutoSettings.style.display = 'none';
                diaryTargetChar.style.display = 'none';
                diaryManualBlock.style.display = 'block';
            } else {
                diaryAutoSettings.style.display = 'block';
                diaryTargetChar.style.display = 'block';
                diaryManualBlock.style.display = 'none';
            }
        }
    };
    
    if (diaryRunModeSelect) {
        diaryRunModeSelect.addEventListener('change', updateDiaryUIVisibility);
        updateDiaryUIVisibility();
    }

    // Bind character diary button
    const diaryCharacterNameInput = document.getElementById('ape_diary_character_name');
    const addDiaryButton = document.getElementById('ape_add_diary_button');
    const diaryPromptTextarea = document.getElementById('ape_diary_prompt');

    if (addDiaryButton && diaryCharacterNameInput) {
        // Load diary prompt from settings
        if (diaryPromptTextarea && settings.diaryPrompt) {
            diaryPromptTextarea.value = settings.diaryPrompt;
        }

        // Save diary prompt when changed
        if (diaryPromptTextarea) {
            diaryPromptTextarea.addEventListener('change', () => {
                const currentSettings = getSettings();
                currentSettings.diaryPrompt = diaryPromptTextarea.value;
                saveSettings(currentSettings);
            });
        }

        addDiaryButton.addEventListener('click', async () => {
            const characterName = diaryCharacterNameInput.value.trim();
            
            if (!characterName) {
                toastr.error("请输入角色名称", "角色日志");
                return;
            }
            
            mainLogger.info(`开始生成角色日志: ${characterName}`);
            toastr.info(`正在为 "${characterName}" 生成日志...`, "角色日志");
            
            addDiaryButton.disabled = true;
            const originalHTML = addDiaryButton.innerHTML;
            addDiaryButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
            
            try {
                // Save current diary prompt before generating
                if (diaryPromptTextarea) {
                    const currentSettings = getSettings();
                    currentSettings.diaryPrompt = diaryPromptTextarea.value;
                    saveSettings(currentSettings);
                }

                const success = await addCharacterDiary(characterName);
                
                if (success) {
                    toastr.success(`角色 "${characterName}" 的日志已成功生成并追加`, "角色日志");
                    diaryCharacterNameInput.value = ''; // 清空输入框
                } else {
                    toastr.warning(`未能为 "${characterName}" 生成日志，可能没有重要事件`, "角色日志");
                }
            } catch (error) {
                toastr.error(`生成日志失败: ${error.message}`, "角色日志");
                mainLogger.error(`[角色日志] 错误: ${error.message}`);
            } finally {
                addDiaryButton.disabled = false;
                addDiaryButton.innerHTML = originalHTML;
            }
        });

        // 支持按回车键生成
        diaryCharacterNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addDiaryButton.click();
            }
        });
    }

    // Tab switching logic
    const tabButtons = document.querySelectorAll('.ape_tab_button');
    const tabContents = document.querySelectorAll('.ape_tab_content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Remove active class from all tabs and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            button.classList.add('active');
            const targetContent = document.querySelector(`.ape_tab_content[data-tab="${targetTab}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

    // Bind worldbook delete buttons
    const deleteInstructionInput = document.getElementById('ape_delete_instruction');
    const deleteEntriesButton = document.getElementById('ape_delete_entries_button');
    const deleteAllDiariesButton = document.getElementById('ape_delete_all_diaries_button');

    if (deleteEntriesButton && deleteInstructionInput) {
        deleteEntriesButton.addEventListener('click', async () => {
            const instruction = deleteInstructionInput.value.trim();
            
            if (!instruction) {
                toastr.error("请输入删除指令", "世界书管理");
                return;
            }
            
            // 二次确认
            if (!confirm(`⚠️ 确定要执行删除操作吗？\n\n指令：${instruction}\n\n此操作不可撤销！`)) {
                return;
            }
            
            mainLogger.info(`开始执行删除指令: ${instruction}`);
            
            deleteEntriesButton.disabled = true;
            const originalHTML = deleteEntriesButton.innerHTML;
            deleteEntriesButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 分析中...';
            
            try {
                const result = await deleteWorldBookEntries(instruction);
                
                if (result.deleted > 0) {
                    deleteInstructionInput.value = ''; // 清空输入框
                }
            } catch (error) {
                mainLogger.error(`[世界书管理] 删除失败: ${error.message}`);
            } finally {
                deleteEntriesButton.disabled = false;
                deleteEntriesButton.innerHTML = originalHTML;
            }
        });
    }

    if (deleteAllDiariesButton) {
        deleteAllDiariesButton.addEventListener('click', async () => {
            // 二次确认
            if (!confirm('⚠️ 确定要删除所有日志条目吗？\n\n此操作将删除所有备注包含"角色日志"的条目，不可撤销！')) {
                return;
            }
            
            mainLogger.info("开始删除所有日志条目");
            
            deleteAllDiariesButton.disabled = true;
            const originalHTML = deleteAllDiariesButton.innerHTML;
            deleteAllDiariesButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 删除中...';
            
            try {
                await deleteAllDiaryEntries();
            } catch (error) {
                mainLogger.error(`[世界书管理] 删除失败: ${error.message}`);
            } finally {
                deleteAllDiariesButton.disabled = false;
                deleteAllDiariesButton.innerHTML = originalHTML;
            }
        });
    }

    // Modal save button
    const modalSaveButton = document.getElementById('ape_modal_save');
    if (modalSaveButton) {
        modalSaveButton.addEventListener('click', () => {
            saveAllFromUI();
            toastr.success("设置已保存", "AI组手");
            hideModal();
        });
    }
    
    console.log(`[${extensionName}] Settings UI initialized.`);
}
