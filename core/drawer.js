/**
 * @file drawer.js
 * @description Manages the creation of the settings panel drawer for the extension.
 * This is adapted from a known working example to ensure compatibility.
 */

import { getContext } from '/scripts/extensions.js';
import { slideToggle } from '/lib.js';

const extensionName = "SillyTavern-AutoPlotEngine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * Creates the drawer in the extensions panel and handles its toggle logic.
 */
export async function createDrawer() {
    // Prevent duplicate creation
    if ($("#ape_extension_frame").length > 0) return;

    const frameHtml = `
      <div id="ape_extension_frame">
          <div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header">
                  <b><i class="fas fa-brain"></i> 自动剧情引擎</b>
                  <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
              </div>
              <div class="inline-drawer-content" style="display: none;">
                  <!-- Content will be loaded here -->
              </div>
          </div>
      </div>
    `;

    // Append the frame to the correct container in the extensions tab
    const $extensionsContainer = $('#extensions_settings2');
    if ($extensionsContainer.length === 0) {
        console.error(`[${extensionName}] Could not find the extensions container #extensions_settings2.`);
        return;
    }
    $extensionsContainer.append(frameHtml);

    const $frame = $("#ape_extension_frame");
    const $contentPanel = $frame.find('.inline-drawer-content');
    const $toggle = $frame.find('.inline-drawer-toggle');
    const $icon = $frame.find('.inline-drawer-icon');

    // Load the actual settings HTML into the content panel
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $contentPanel.html(settingsHtml);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load settings.html:`, error);
        $contentPanel.html('<p style="color:red;">错误：无法加载设置面板内容。</p>');
    }

    // We do NOT bind a click event here.
    // SillyTavern's global script will automatically handle the toggling
    // for any element with the class 'inline-drawer-toggle'.
    // Manually adding a handler would cause a conflict.

    console.log(`[${extensionName}] Drawer created successfully in extensions panel.`);
}
