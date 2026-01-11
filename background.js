// ==================== FlowUs API基础配置 ====================
const FLOWUS_API_BASE = "https://api.flowus.cn/v1";

// ==================== 获取用户配置 ====================
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['flowus_token', 'flowus_page_id'], (result) => {
      resolve({
        token: result.flowus_token || '',
        pageId: result.flowus_page_id || ''
      });
    });
  });
}

// ==================== 创建右键菜单 ====================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveTweetToMarkdown",
    title: "保存推文到本地 Markdown",
    contexts: ["all"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"]
  });
  
  chrome.contextMenus.create({
    id: "saveTweetToFlowUs",
    title: "保存推文到 FlowUs",
    contexts: ["all"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"]
  });
});

// ==================== 右键菜单点击处理 ====================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("Menu clicked:", info.menuItemId);
  
  if (info.menuItemId === "saveTweetToMarkdown" || info.menuItemId === "saveTweetToFlowUs" || info.menuItemId === "downloadVideo") {
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
          if (info.menuItemId === "saveTweetToMarkdown") {
            const markdown = generateMarkdown(response.data);
            downloadMarkdown(markdown, response.data.author);
            console.log("已保存到本地Markdown");
          } else if (info.menuItemId === "saveTweetToFlowUs") {
            await handleSaveToFlowUs(response.data, tab.id);
          } else if (info.menuItemId === "downloadVideo") {
            await handleDownloadVideo(response.data, tab.id);
          }
        } else {
          console.error("获取推文失败:", response?.error);
          sendToast(tab.id, "获取推文失败", "error");
        }
      });
    });
  }
});

// ==================== 视频下载处理 ====================

async function handleDownloadVideo(data, tabId) {
  // 优先处理 YouTube 等外部视频
  if (data.videoUrl && (data.videoUrl.includes("youtube.com") || data.videoUrl.includes("youtu.be"))) {
    sendToast(tabId, "暂不支持下载 YouTube 视频，请使用第三方工具", "info");
    return;
  }

  const tweetId = data.tweetId;
  if (!tweetId) {
    sendToast(tabId, "未找到 Tweet ID", "error");
    return;
  }

  sendToast(tabId, "正在获取视频地址...", "info");

  // 委托 Content Script 获取真实视频地址 (利用页面Cookie)
  chrome.tabs.sendMessage(tabId, { action: "fetchVideoUrl", tweetId: tweetId }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("通信错误:", chrome.runtime.lastError);
      return;
    }

    if (response && response.success && response.url) {
      console.log("获取到视频 URL:", response.url);
      
      const filename = `twitter_${data.author}_${tweetId}.mp4`;
      
      chrome.downloads.download({
        url: response.url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
           sendToast(tabId, "下载启动失败: " + chrome.runtime.lastError.message, "error");
        } else {
           sendToast(tabId, "开始下载视频...", "success");
        }
      });

    } else {
      console.error("获取视频地址失败:", response?.error);
      sendToast(tabId, "获取视频失败: " + (response?.error || "未知错误"), "error");
    }
  });
}

// ==================== FlowUs保存处理 ====================

async function handleSaveToFlowUs(data, tabId) {
  // 获取配置
  const config = await getConfig();
  
  // 检查配置
  if (!config.token || !config.pageId) {
    console.error("FlowUs未配置");
    sendToast(tabId, "请先点击扩展图标配置FlowUs", "error");
    return;
  }
  
  try {
    await saveToFlowUs(data, config.token, config.pageId);
    console.log("已保存到FlowUs");
    sendToast(tabId, "已保存到FlowUs!", "success");
  } catch (error) {
    console.error("FlowUs保存失败:", error.message);
    sendToast(tabId, "保存失败: " + error.message, "error");
  }
}

// 发送Toast通知到页面
function sendToast(tabId, message, type) {
  chrome.tabs.sendMessage(tabId, { action: "showToast", message, type });
}

// ==================== FlowUs API ====================

async function saveToFlowUs(data, token, parentPageId) {
  console.log("=== 保存到FlowUs ===");
  console.log("作者:", data.author);
  
  // 生成标题格式: yyyyMMddhhmmss@author
  let dateStr = "";
  try {
    const date = new Date(data.date);
    if (!isNaN(date.getTime())) {
      // 转换为北京时间 (UTC+8) 以确保日期准确
      const beijingOffset = 8 * 60 * 60 * 1000;
      const beijingTime = new Date(date.getTime() + beijingOffset);
      const year = beijingTime.getUTCFullYear();
      const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(beijingTime.getUTCDate()).padStart(2, '0');
      const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
      const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
      dateStr = `${year}${month}${day}${hours}${minutes}${seconds}`;
    }
  } catch (e) {
    dateStr = "UnknownDate";
  }

  const titleText = `X@${dateStr}@${data.author}`;
  
  // 1. 创建页面
  console.log("创建页面...");
  const pageResponse = await fetch(`${FLOWUS_API_BASE}/pages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      icon: { emoji: "🐦" },
      properties: {
        title: {
          type: "title",
          title: [{ text: { content: titleText } }]
        }
      }
    })
  });
  
  console.log("创建页面响应:", pageResponse.status);
  
  if (!pageResponse.ok) {
    const errorText = await pageResponse.text();
    console.error("创建页面错误:", errorText);
    throw new Error(`创建页面失败(${pageResponse.status})`);
  }
  
  const pageResult = await pageResponse.json();
  const pageData = pageResult.data || pageResult;
  const newPageId = pageData.id;
  console.log("页面已创建, ID:", newPageId);
  
  // 2. 添加内容块
  const blocks = buildFlowUsBlocks(data);
  console.log("添加", blocks.length, "个内容块...");
  console.log("Blocks数据:", JSON.stringify(blocks, null, 2));
  
  const blocksResponse = await fetch(`${FLOWUS_API_BASE}/blocks/${newPageId}/children`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ children: blocks })
  });
  
  console.log("添加内容块响应:", blocksResponse.status);
  
  const blocksResultText = await blocksResponse.text();
  console.log("添加内容块响应内容:", blocksResultText);
  
  if (!blocksResponse.ok) {
    console.error("添加内容块错误:", blocksResultText);
    throw new Error(`添加内容失败(${blocksResponse.status})`);
  }
  
  console.log("=== FlowUs保存完成 ===");
  return { page: pageData };
}

function buildFlowUsBlocks(data) {
  const blocks = [];
  const beijingDate = formatDateBeijing(data.date);
  
  // 元信息 callout
  blocks.push({
    type: "callout",
    data: {
      rich_text: [
        createTextRichText(`📅 ${beijingDate}\n🔗 `, null),
        createTextRichText(data.url, data.url)
      ],
      icon: { emoji: "ℹ️" }
    }
  });
  
  // 推文内容
  if (data.tweets && data.tweets.length > 0) {
    data.tweets.forEach((tweet, index) => {
      if (data.tweets.length > 1) {
        blocks.push({
          type: "heading_3",
          data: {
            rich_text: [createTextRichText(`${index + 1}/${data.tweets.length}`, null)]
          }
        });
      }
      
      if (tweet.content) {
        // 将内容转换为带链接的富文本
        const richText = parseContentToRichText(tweet.content);
        blocks.push({
          type: "paragraph",
          data: { rich_text: richText }
        });
      }
      
      if (tweet.images && tweet.images.length > 0) {
        tweet.images.forEach(imgUrl => {
          const tweetUrl = tweet.url || data.url;
          blocks.push({
            type: "image",
            data: {
              type: "external",
              external: { url: imgUrl },
              // 为图片增加超链接属性
              link: tweet.hasVideo ? { url: tweetUrl } : null,
              caption: []
            }
          });
        });
      }

      if (tweet.hasVideo) {
        const videoUrl = tweet.videoUrl || tweet.url || data.url;
        // 显式展示视频链接
        blocks.push({
          type: "paragraph",
          data: {
            rich_text: [
              createTextRichText("📺 视频链接: ", null),
              createTextRichText(videoUrl, videoUrl)
            ]
          }
        });

        // 尝试使用视频块 (保留作为增强功能)
        blocks.push({
          type: "video",
          data: {
            type: "external",
            external: { url: videoUrl }
          }
        });
      }
      
      if (data.tweets.length > 1 && index < data.tweets.length - 1) {
        blocks.push({ type: "divider", data: {} });
      }
    });
  }
  
  return blocks;
}

// 将内容解析为FlowUs富文本格式，识别URL并转换为链接
function parseContentToRichText(content) {
  const richText = [];
  
  // URL正则表达式
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = urlRegex.exec(content)) !== null) {
    // 添加URL之前的普通文本
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        richText.push(createTextRichText(textBefore, null));
      }
    }
    
    // 添加URL作为链接
    const url = match[0];
    richText.push(createTextRichText(url, url));
    
    lastIndex = match.index + match[0].length;
  }
  
  // 添加最后一段普通文本
  if (lastIndex < content.length) {
    richText.push(createTextRichText(content.substring(lastIndex), null));
  }
  
  // 如果没有任何内容，返回空文本
  if (richText.length === 0) {
    richText.push(createTextRichText(content, null));
  }
  
  return richText;
}

// 创建FlowUs富文本对象
function createTextRichText(content, linkUrl) {
  // 简化格式，只保留必要字段
  if (linkUrl) {
    return {
      type: "text",
      text: {
        content: content,
        link: { url: linkUrl }
      }
    };
  } else {
    return {
      type: "text",
      text: {
        content: content,
        link: null
      }
    };
  }
}

// ==================== Markdown生成 ====================

function generateMarkdown(data) {
  const lines = [];
  
  if (data.isThread && data.tweets && data.tweets.length > 1) {
    lines.push(`# Thread by @${data.author} (${data.tweets.length} tweets)`);
  } else {
    lines.push(`# Tweet by @${data.author}`);
  }
  lines.push("");
  lines.push("## Info");
  lines.push("");
  lines.push(`- **Author:** [@${data.author}](https://x.com/${data.author})`);
  lines.push(`- **Date:** ${formatDateBeijing(data.date)}`);
  lines.push(`- **URL:** ${data.url}`);
  if (data.isThread) lines.push(`- **Tweets:** ${data.tweets.length}`);
  lines.push("");
  lines.push("## Content");
  lines.push("");
  
  if (data.tweets && data.tweets.length > 0) {
    data.tweets.forEach((tweet, index) => {
      if (data.tweets.length > 1) {
        lines.push(`### ${index + 1}/${data.tweets.length}`);
        lines.push("");
      }
      if (tweet.content) lines.push(tweet.content);
      if (tweet.images && tweet.images.length > 0) {
        lines.push("");
        tweet.images.forEach(img => lines.push(`![Image](${img})`));
      }
      if (data.tweets.length > 1 && tweet.url) {
        lines.push("");
        lines.push(`> [Link](${tweet.url})`);
      }
      lines.push("");
      if (data.tweets.length > 1 && index < data.tweets.length - 1) {
        lines.push("---");
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

function downloadMarkdown(content, author) {
  const now = new Date();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(now.getTime() + beijingOffset);
  const date = `${beijingTime.getUTCFullYear()}-${String(beijingTime.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingTime.getUTCDate()).padStart(2, '0')}`;
  const filename = `tweet_${author}_${date}.md`;
  const base64Content = btoa(unescape(encodeURIComponent(content)));
  const dataUrl = `data:text/markdown;base64,${base64Content}`;
  chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

console.log("X2Flow background loaded");
