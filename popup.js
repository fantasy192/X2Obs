// 当前选中的模式
let currentMode = 'local';

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupToggle();
});

// 保存按钮点击
document.getElementById('saveBtn').addEventListener('click', saveConfig);

// 设置切换按钮
function setupToggle() {
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setMode(mode);
    });
  });
}

// 设置模式
function setMode(mode) {
  currentMode = mode;

  // 更新按钮状态
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // 更新面板显示
  document.getElementById('localPanel').classList.toggle('active', mode === 'local');
  document.getElementById('githubPanel').classList.toggle('active', mode === 'github');

  // 更新状态显示
  document.getElementById('localPathRow').style.display = mode === 'local' ? 'flex' : 'none';
  document.getElementById('githubRepoRow').style.display = mode === 'github' ? 'flex' : 'none';
  document.getElementById('modeStatus').textContent = mode === 'local' ? '本地下载' : 'GitHub';
}

// 加载配置
function loadConfig() {
  chrome.storage.sync.get([
    'save_mode',
    'markdown_save_path',
    'github_token',
    'github_repo',
    'github_path',
    'github_branch'
  ], (result) => {
    // 设置模式
    const mode = result.save_mode || 'local';
    setMode(mode);

    // 本地配置
    document.getElementById('savePath').value = result.markdown_save_path || '';

    // GitHub 配置
    document.getElementById('githubToken').value = result.github_token || '';
    document.getElementById('githubRepo').value = result.github_repo || '';
    document.getElementById('githubPath').value = result.github_path || '';
    document.getElementById('githubBranch').value = result.github_branch || '';

    // 更新状态显示
    updateStatusDisplay(result);
  });
}

// 保存配置
function saveConfig() {
  const saveBtn = document.getElementById('saveBtn');

  // 获取所有值
  let savePath = document.getElementById('savePath').value.trim();
  const githubToken = document.getElementById('githubToken').value.trim();
  const githubRepo = document.getElementById('githubRepo').value.trim();
  let githubPath = document.getElementById('githubPath').value.trim();
  const githubBranch = document.getElementById('githubBranch').value.trim() || 'main';

  // 规范化路径
  savePath = normalizePath(savePath);
  githubPath = normalizePath(githubPath);

  // 更新输入框
  document.getElementById('savePath').value = savePath;
  document.getElementById('githubPath').value = githubPath;

  // 验证 GitHub 配置
  if (currentMode === 'github') {
    if (!githubToken) {
      showStatus('请输入 GitHub Token', 'error');
      return;
    }
    if (!githubRepo) {
      showStatus('请输入仓库名称', 'error');
      return;
    }
    if (!githubRepo.includes('/')) {
      showStatus('仓库格式应为 owner/repo', 'error');
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  // 保存到 chrome.storage.sync
  chrome.storage.sync.set({
    save_mode: currentMode,
    markdown_save_path: savePath,
    github_token: githubToken,
    github_repo: githubRepo,
    github_path: githubPath,
    github_branch: githubBranch
  }, () => {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存设置';

    if (chrome.runtime.lastError) {
      showStatus('保存失败: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('设置已保存', 'success');
      updateStatusDisplay({
        save_mode: currentMode,
        markdown_save_path: savePath,
        github_token: githubToken,
        github_repo: githubRepo,
        github_path: githubPath
      });
    }
  });
}

// 规范化路径
function normalizePath(path) {
  if (!path) return '';
  // 移除开头的斜杠和反斜杠
  path = path.replace(/^[\/\\]+/, '');
  // 将反斜杠替换为正斜杠
  path = path.replace(/\\/g, '/');
  // 移除末尾的斜杠
  path = path.replace(/[\/]+$/, '');
  return path;
}

// 显示状态消息
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;

  // 3秒后隐藏
  setTimeout(() => {
    statusEl.style.display = 'none';
    statusEl.className = 'status';
  }, 3000);
}

// 更新状态显示
function updateStatusDisplay(config) {
  const localPathStatus = document.getElementById('localPathStatus');
  const githubRepoStatus = document.getElementById('githubRepoStatus');

  // 本地路径状态
  if (config.markdown_save_path) {
    localPathStatus.innerHTML = `<span class="status-dot active"></span>下载/${config.markdown_save_path}/`;
  } else {
    localPathStatus.innerHTML = `<span class="status-dot inactive"></span>下载目录`;
  }

  // GitHub 状态
  if (config.github_token && config.github_repo) {
    const path = config.github_path ? `/${config.github_path}` : '';
    githubRepoStatus.innerHTML = `<span class="status-dot active"></span>${config.github_repo}${path}`;
  } else {
    githubRepoStatus.innerHTML = `<span class="status-dot inactive"></span>未配置`;
  }
}
