// 页面加载时读取已保存的配置
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
});

// 保存按钮点击
document.getElementById('saveBtn').addEventListener('click', saveConfig);

// 加载配置
function loadConfig() {
  chrome.storage.sync.get(['flowus_token', 'flowus_page_id'], (result) => {
    const token = result.flowus_token || '';
    const pageId = result.flowus_page_id || '';
    
    document.getElementById('token').value = token;
    document.getElementById('pageId').value = pageId;
    
    updateStatus(token, pageId);
  });
}

// 保存配置
function saveConfig() {
  const token = document.getElementById('token').value.trim();
  const pageId = document.getElementById('pageId').value.trim();
  
  const statusEl = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');
  
  // 验证输入
  if (!token) {
    showStatus('请输入FlowUs Token', 'error');
    return;
  }
  
  if (!pageId) {
    showStatus('请输入目标页面ID', 'error');
    return;
  }
  
  // 验证页面ID格式（UUID格式）
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(pageId)) {
    showStatus('页面ID格式不正确，应为UUID格式', 'error');
    return;
  }
  
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';
  
  // 保存到chrome.storage.sync（跨设备同步）
  chrome.storage.sync.set({
    flowus_token: token,
    flowus_page_id: pageId
  }, () => {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存设置';
    
    if (chrome.runtime.lastError) {
      showStatus('保存失败: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('✓ 设置已保存', 'success');
      updateStatus(token, pageId);
      
      // 3秒后隐藏成功提示
      setTimeout(() => {
        document.getElementById('status').style.display = 'none';
      }, 3000);
    }
  });
}

// 显示状态消息
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
}

// 更新状态显示
function updateStatus(token, pageId) {
  const tokenStatusEl = document.getElementById('tokenStatus');
  const pageIdStatusEl = document.getElementById('pageIdStatus');
  
  if (token) {
    // 只显示token的前8位和后4位
    const maskedToken = token.length > 12 
      ? token.substring(0, 8) + '...' + token.substring(token.length - 4)
      : token;
    tokenStatusEl.innerHTML = `<span class="status-dot active"></span>${maskedToken}`;
  } else {
    tokenStatusEl.innerHTML = `<span class="status-dot inactive"></span>未配置`;
  }
  
  if (pageId) {
    // 只显示页面ID的前8位
    const shortId = pageId.substring(0, 8) + '...';
    pageIdStatusEl.innerHTML = `<span class="status-dot active"></span>${shortId}`;
  } else {
    pageIdStatusEl.innerHTML = `<span class="status-dot inactive"></span>未配置`;
  }
}
