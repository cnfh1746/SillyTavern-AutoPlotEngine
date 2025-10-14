/**
 * @file logger.js
 * @description Unified logging system that outputs to both console and UI panel
 */

const LOG_LEVELS = {
    INFO: { color: '#0f0', prefix: '[INFO]' },
    WARN: { color: '#ff0', prefix: '[WARN]' },
    ERROR: { color: '#f00', prefix: '[ERROR]' },
    SUCCESS: { color: '#0ff', prefix: '[SUCCESS]' },
    DEBUG: { color: '#888', prefix: '[DEBUG]' }
};

class Logger {
    constructor(moduleName) {
        this.moduleName = moduleName;
        this.logPanel = null;
        this.maxLogEntries = 500;
    }

    /**
     * Initialize the logger with the log panel element
     */
    init() {
        this.logPanel = document.getElementById('ape_log_panel');
        if (this.logPanel) {
            this.info('日志系统已初始化');
        }
    }

    /**
     * Format timestamp
     */
    getTimestamp() {
        const now = new Date();
        return now.toLocaleTimeString('zh-CN', { hour12: false });
    }

    /**
     * Internal log method
     */
    _log(level, message, data = null) {
        const timestamp = this.getTimestamp();
        const fullMessage = `[${this.moduleName}] ${message}`;
        const levelInfo = LOG_LEVELS[level] || LOG_LEVELS.INFO;

        // Always log to console
        const consoleMessage = `${timestamp} ${levelInfo.prefix} ${fullMessage}`;
        if (level === 'ERROR') {
            console.error(consoleMessage, data || '');
        } else if (level === 'WARN') {
            console.warn(consoleMessage, data || '');
        } else {
            console.log(consoleMessage, data || '');
        }

        // Log to UI panel if available
        if (this.logPanel) {
            const logEntry = document.createElement('div');
            logEntry.style.color = levelInfo.color;
            logEntry.style.marginBottom = '2px';
            
            let displayMessage = `${timestamp} ${levelInfo.prefix} ${fullMessage}`;
            if (data) {
                try {
                    displayMessage += '\n' + JSON.stringify(data, null, 2);
                } catch (e) {
                    displayMessage += '\n' + String(data);
                }
            }
            
            logEntry.textContent = displayMessage;
            
            // Remove placeholder if exists
            const placeholder = this.logPanel.querySelector('div[style*="color: #888"]');
            if (placeholder && placeholder.textContent.includes('等待运行日志')) {
                placeholder.remove();
            }
            
            this.logPanel.appendChild(logEntry);
            
            // Limit log entries
            const entries = this.logPanel.children;
            if (entries.length > this.maxLogEntries) {
                this.logPanel.removeChild(entries[0]);
            }
            
            // Auto-scroll to bottom
            this.logPanel.scrollTop = this.logPanel.scrollHeight;
        }
    }

    /**
     * Log info message
     */
    info(message, data = null) {
        this._log('INFO', message, data);
    }

    /**
     * Log warning message
     */
    warn(message, data = null) {
        this._log('WARN', message, data);
    }

    /**
     * Log error message
     */
    error(message, data = null) {
        this._log('ERROR', message, data);
    }

    /**
     * Log success message
     */
    success(message, data = null) {
        this._log('SUCCESS', message, data);
    }

    /**
     * Log debug message
     */
    debug(message, data = null) {
        this._log('DEBUG', message, data);
    }

    /**
     * Clear the log panel
     */
    clear() {
        if (this.logPanel) {
            this.logPanel.innerHTML = '<div style="color: #888;">[日志已清空]</div>';
        }
    }
}

// Create global logger instances
export const mainLogger = new Logger('主引擎');
export const plotLogger = new Logger('剧情生成');
export const infoLogger = new Logger('信息聚合');
export const apiLogger = new Logger('API调用');

// Initialize all loggers
export function initLoggers() {
    mainLogger.init();
    plotLogger.init();
    infoLogger.init();
    apiLogger.init();
}

// Clear all logs
export function clearAllLogs() {
    mainLogger.clear();
}
