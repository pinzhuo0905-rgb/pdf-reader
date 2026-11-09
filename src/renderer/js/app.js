/* 启动 */
window.addEventListener('DOMContentLoaded', async () => {
  App.viewer.init();
  App.textedit.init();
  App.ocr.init();
  App.ui.init();

  try {
    const s = await window.api.getSettings();
    App.state.settings = s || {};
    App.ui.applyTheme((s && s.theme) || 'light');
  } catch (e) {
    App.state.settings = {};
  }

  // 首屏提示
  setTimeout(() => {
    const empty = document.getElementById('empty');
    if (empty && !empty.classList.contains('hidden')) {
      // 保持空状态，等待用户操作
    }
  }, 100);
});
