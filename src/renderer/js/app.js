/* 启动 */
window.addEventListener('DOMContentLoaded', async () => {
  App.viewer.init();
  App.textedit.init();
  App.ocr.init();
  App.ui.init();

  try {
    const s = await window.api.getSettings();
    Object.assign(App.settings, s || {});
    App.ui.applyTheme((s && s.theme) || 'light');
  } catch (e) {
    /* 使用默认设置 */
  }

  // 标签页：创建首个空白标签页，并接上文件关联 / 拖出窗口事件
  App.tabs.init();
});
