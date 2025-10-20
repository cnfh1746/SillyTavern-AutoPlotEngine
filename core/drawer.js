/**
 * @file drawer.js
 * @description 创建扩展面板按钮并管理弹出式设置对话框
 */

const extensionName = "SillyTavern-AutoPlotEngine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * 显示弹出式设置对话框
 */
export function showModal() {
    const $overlay = $('#ape_modal_overlay');
    if ($overlay.length > 0) {
        $overlay.fadeIn(200);
    }
}

/**
 * 隐藏弹出式设置对话框
 */
export function hideModal() {
    const $overlay = $('#ape_modal_overlay');
    if ($overlay.length > 0) {
        $overlay.fadeOut(200);
    }
}

/**
 * 创建扩展面板中的简洁按钮
 */
export async function createDrawer() {
    // 防止重复创建
    if ($("#ape_extension_frame").length > 0) return;

    // 创建简洁的按钮框架
    const frameHtml = `
      <div id="ape_extension_frame" style="padding: 15px; border-bottom: 1px solid var(--SmartThemeBorderColor, #333);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 12px;">
                  <i class="fas fa-brain" style="font-size: 1.5em; color: #8b7fc6;"></i>
                  <div>
                      <h4 style="margin: 0; color: var(--SmartThemeBodyColor, #e0e0e0);">自动剧情引擎</h4>
                      <small style="color: var(--grey70, #999);">智能剧情生成与角色日志系统</small>
                  </div>
              </div>
              <button id="ape_open_settings_button" class="menu_button" style="padding: 10px 20px;">
                  <i class="fas fa-cog"></i> 打开设置
              </button>
          </div>
      </div>
    `;

    // 添加到扩展设置容器
    const $extensionsContainer = $('#extensions_settings2');
    if ($extensionsContainer.length === 0) {
        console.error(`[${extensionName}] Could not find the extensions container #extensions_settings2.`);
        return;
    }
    $extensionsContainer.append(frameHtml);

    // 加载模态对话框HTML
    try {
        const modalHtml = await $.get(`${extensionFolderPath}/modal_settings.html`);
        $('body').append(modalHtml);
        
        // 加载模态对话框CSS
        const modalCssLink = document.createElement('link');
        modalCssLink.rel = 'stylesheet';
        modalCssLink.href = `${extensionFolderPath}/modal_style.css`;
        document.head.appendChild(modalCssLink);
        
    } catch (error) {
        console.error(`[${extensionName}] Failed to load modal:`, error);
        return;
    }

    // 绑定按钮点击事件
    $('#ape_open_settings_button').on('click', () => {
        showModal();
    });

    // 绑定模态对话框关闭事件
    $('#ape_modal_close, #ape_modal_cancel').on('click', () => {
        hideModal();
    });

    // 点击遮罩层关闭
    $('#ape_modal_overlay').on('click', function(e) {
        if (e.target === this) {
            hideModal();
        }
    });

    // ESC键关闭
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#ape_modal_overlay').is(':visible')) {
            hideModal();
        }
    });

    console.log(`[${extensionName}] Extension panel button created successfully.`);
}
