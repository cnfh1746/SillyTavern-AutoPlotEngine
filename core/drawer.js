/**
 * @file drawer.js
 * @description 创建扩展面板可折叠抽屉并管理弹出式设置对话框
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
 * 创建扩展面板中的可折叠抽屉
 */
export async function createDrawer() {
    // 防止重复创建
    if ($("#ape_extension_frame").length > 0) return;

    // 创建可折叠的抽屉框架
    const frameHtml = `
      <div id="ape_extension_frame">
          <div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header">
                  <b><i class="fas fa-brain"></i> 自动剧情引擎</b>
                  <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
              </div>
              <div class="inline-drawer-content" style="display: none;">
                  <div style="padding: 15px;">
                      <div style="display: flex; flex-direction: column; gap: 10px;">
                          <p style="margin: 0; color: var(--grey70, #999); font-size: 0.9em;">
                              智能剧情生成与角色日志系统
                          </p>
                          <button id="ape_open_settings_button" class="menu_button" style="width: 100%;">
                              <i class="fas fa-cog"></i> 打开设置
                          </button>
                      </div>
                  </div>
              </div>
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

    console.log(`[${extensionName}] Collapsible drawer with modal created successfully.`);
}
