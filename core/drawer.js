/**
 * @file drawer.js
 * @description 创建扩展面板可折叠抽屉（标准内嵌方式）
 */

const extensionName = "SillyTavern-AutoPlotEngine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * 创建扩展面板中的可折叠抽屉（使用标准内嵌方式）
 */
export async function createDrawer() {
    // 防止重复创建
    if ($("#ape_extension_frame").length > 0) return;

    // 创建可折叠的抽屉框架（标准SillyTavern风格）
    const frameHtml = `
      <div id="ape_extension_frame">
          <div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header">
                  <b><i class="fas fa-brain"></i> AI组手</b>
                  <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
              </div>
              <div class="inline-drawer-content" style="display: none;">
                  <!-- 设置面板将在这里加载 -->
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

    try {
        // 加载设置面板HTML到抽屉内容区
        const contentWrapper = $('#ape_extension_frame .inline-drawer-content');
        const settingsPanelHtml = await $.get(`${extensionFolderPath}/settings.html?v=${Date.now()}`);
        contentWrapper.html(settingsPanelHtml);
        
        console.log(`[${extensionName}] Settings panel loaded successfully.`);

        // 初始化UI绑定（如果有的话）
        if (typeof window.initializeAPEBindings === 'function') {
            window.initializeAPEBindings();
        }

    } catch (error) {
        console.error(`[${extensionName}] Failed to load settings panel:`, error);
        $('#ape_extension_frame .inline-drawer-content').html(
            '<p style="color:red; padding:10px;">错误：无法加载设置界面。</p>'
        );
    }

    console.log(`[${extensionName}] Drawer created successfully with inline design.`);
}
