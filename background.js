// ==================== 获取用户配置 ====================
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([
      'save_mode',
      'markdown_save_path',
      'github_token',
      'github_repo',
      'github_path',
      'github_branch'
    ], (result) => {
      resolve({
        mode: result.save_mode || 'local',
        savePath: result.markdown_save_path || '',
        github: {
          token: result.github_token || '',
          repo: result.github_repo || '',
          path: result.github_path || '',
          branch: result.github_branch || 'main'
        }
      });
    });
  });
}

// ==================== 创建右键菜单 ====================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveTweetToMarkdown",
    title: "保存推文到 Markdown",
    contexts: ["all"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"]
  });
});

// ==================== 右键菜单点击处理 ====================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("Menu clicked:", info.menuItemId);

  if (info.menuItemId === "saveTweetToMarkdown") {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    }).then(() => {
      chrome.tabs.sendMessage(tab.id, { action: "getTweetData" }, async (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error:", chrome.runtime.lastError.message);
          return;
        }

        if (response && response.success) {
          const config = await getConfig();
          const markdown = generateMarkdown(response.data);
          const filename = generateFilename(response.data.author);

          if (config.mode === 'github') {
            // 提交到 GitHub
            await saveToGitHub(markdown, filename, config.github, tab.id);
          } else {
            // 本地下载
            downloadMarkdown(markdown, filename, config.savePath);
            sendToast(tab.id, "已保存到本地!", "success");
          }
          console.log("保存完成");
        } else {
          console.error("获取推文失败:", response?.error);
          sendToast(tab.id, "获取推文失败", "error");
        }
      });
    });
  }
});

// ==================== GitHub API ====================

async function saveToGitHub(content, filename, githubConfig, tabId) {
  const { token, repo, path, branch } = githubConfig;

  if (!token || !repo) {
    sendToast(tabId, "请先配置 GitHub Token 和仓库", "error");
    return;
  }

  // 构建文件路径
  const filePath = path ? `${path}/${filename}` : filename;

  sendToast(tabId, "正在提交到 GitHub...", "info");

  try {
    // Base64 编码内容
    const contentBase64 = btoa(unescape(encodeURIComponent(content)));

    // 调用 GitHub API
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Add tweet: ${filename}`,
        content: contentBase64,
        branch: branch
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log("GitHub 提交成功:", result.content.html_url);
      sendToast(tabId, "已提交到 GitHub!", "success");
    } else {
      let error;
      try {
        error = await response.json();
      } catch (e) {
        error = { message: `HTTP ${response.status}: ${response.statusText}` };
      }

      console.error("GitHub API 错误 (status:", response.status, "):", JSON.stringify(error, null, 2));

      if (response.status === 401) {
        sendToast(tabId, "GitHub Token 无效或已过期", "error");
      } else if (response.status === 404) {
        sendToast(tabId, "仓库不存在或无权访问", "error");
      } else if (response.status === 422 && error.message?.includes('sha')) {
        // 文件已存在，需要获取 sha 后更新
        await updateExistingFile(content, filePath, githubConfig, tabId);
      } else {
        const errorMsg = error.message || error.error || JSON.stringify(error);
        sendToast(tabId, `GitHub 错误 (${response.status}): ${errorMsg}`, "error");
      }
    }
  } catch (e) {
    console.error("GitHub 请求失败:", e);
    sendToast(tabId, "网络错误，请检查连接", "error");
  }
}

// 更新已存在的文件
async function updateExistingFile(content, filePath, githubConfig, tabId) {
  const { token, repo, branch } = githubConfig;

  try {
    // 先获取文件的 sha
    const getResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!getResponse.ok) {
      sendToast(tabId, "获取文件信息失败", "error");
      return;
    }

    const fileInfo = await getResponse.json();
    const sha = fileInfo.sha;

    // 更新文件
    const contentBase64 = btoa(unescape(encodeURIComponent(content)));
    const updateResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Update tweet: ${filePath.split('/').pop()}`,
        content: contentBase64,
        branch: branch,
        sha: sha
      })
    });

    if (updateResponse.ok) {
      sendToast(tabId, "已更新到 GitHub!", "success");
    } else {
      const error = await updateResponse.json();
      sendToast(tabId, `更新失败: ${error.message}`, "error");
    }
  } catch (e) {
    console.error("更新文件失败:", e);
    sendToast(tabId, "更新失败", "error");
  }
}

// 发送Toast通知到页面
function sendToast(tabId, message, type) {
  chrome.tabs.sendMessage(tabId, { action: "showToast", message, type });
}

// ==================== Markdown生成 ====================

function generateMarkdown(data) {
  console.log("[X2MD Background] generateMarkdown received data:", {
    tweetsCount: data.tweets?.length,
    firstTweet: data.tweets?.[0] ? {
      hasVideo: data.tweets[0].hasVideo,
      videoUrl: data.tweets[0].videoUrl,
      imagesCount: data.tweets[0].images?.length
    } : null
  });

  const lines = [];

  lines.push(`### 来源: ${data.url}`);
  lines.push("");

  if (data.tweets && data.tweets.length > 0) {
    data.tweets.forEach((tweet, index) => {
      const tweetLines = [];
      if (tweet.content) {
        // inject.js 已经处理了媒体链接的移除，这里直接使用内容
        let content = tweet.content.trim();
        tweetLines.push(content);
      }

      // 处理视频
      if (tweet.hasVideo && tweet.videoUrl) {
        console.log("[X2MD Background] Adding video to markdown:", tweet.videoUrl);
        tweetLines.push("");
        // 使用 HTML video 标签，Obsidian 原生支持
        // 如果有缩略图，使用第一张作为封面
        const posterAttr = (tweet.images && tweet.images.length > 0)
          ? ` poster="${tweet.images[0]}"`
          : '';
        tweetLines.push(`<video src="${tweet.videoUrl}" controls${posterAttr} width="100%"></video>`);
      } else if (tweet.hasVideo) {
        console.log("[X2MD Background] hasVideo is true but videoUrl is missing:", tweet);
      }

      // 处理图片（如果有视频，不显示图片，因为图片是视频缩略图）
      if (!tweet.hasVideo && tweet.images && tweet.images.length > 0) {
        tweetLines.push("");
        tweet.images.forEach(img => tweetLines.push(`![Image](${img})`));
      }

      if (tweet.card) {
        tweetLines.push("");
        tweetLines.push(`[![Card Image](${tweet.card.image})](${tweet.card.url})`);
      }

      if (index === 0) {
        // 主推文内容
        lines.push(...tweetLines);
        lines.push("");
        if (data.tweets.length > 1) {
          lines.push("");
          lines.push("---");
          lines.push("");
        }
      } else {
        // 评论/后续推文内容，使用引用格式
        lines.push(...tweetLines.map(line => line ? `> ${line}` : ">"));
        lines.push("");
      }
    });
  }

  return lines.join("\n");
}

// ==================== 工具函数 ====================

function formatDateBeijing(dateStr) {
  if (!dateStr) return "Unknown";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const beijingOffset = 8 * 60 * 60 * 1000;
    const beijingTime = new Date(date.getTime() + beijingOffset);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return dateStr || "Unknown";
  }
}

function generateFilename(author) {
  const now = new Date();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(now.getTime() + beijingOffset);

  // 生成时间戳: yyyyMMddHHmmss
  const timestamp = `${beijingTime.getUTCFullYear()}${String(beijingTime.getUTCMonth() + 1).padStart(2, '0')}${String(beijingTime.getUTCDate()).padStart(2, '0')}${String(beijingTime.getUTCHours()).padStart(2, '0')}${String(beijingTime.getUTCMinutes()).padStart(2, '0')}${String(beijingTime.getUTCSeconds()).padStart(2, '0')}`;

  // 文件名格式: 时间戳@作者.md
  return `${timestamp}@${author}.md`;
}

function downloadMarkdown(content, filename, savePath) {
  // 如果设置了保存路径，则添加路径前缀
  let fullPath = filename;
  if (savePath) {
    fullPath = `${savePath}/${filename}`;
  }

  const base64Content = btoa(unescape(encodeURIComponent(content)));
  const dataUrl = `data:text/markdown;base64,${base64Content}`;

  chrome.downloads.download({
    url: dataUrl,
    filename: fullPath,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("下载失败:", chrome.runtime.lastError.message);
    } else {
      console.log("下载已开始, ID:", downloadId);
    }
  });
}

console.log("X2MD background loaded");
