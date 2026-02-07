// ==================== 初始化注入脚本 ====================
function injectScript() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = function() {
      this.remove();
  };
  (document.head || document.documentElement).appendChild(s);
  console.log("X2MD injected script");
}

injectScript();

// ==================== 消息监听 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received:", request.action);

  if (request.action === "getTweetData") {
    // 1. 先通过 DOM 找到当前目标的 Tweet ID
    const domTweet = extractThreadData(); // 复用现有逻辑仅为了获取 ID 和基本上下文
    if (!domTweet || !domTweet.tweetId) {
      sendResponse({ success: false, error: "无法在页面上定位推文 ID" });
      return true;
    }

    // 2. 通过注入脚本获取完整数据 (长文、高清图、视频)
    fetchTweetDataFromPage(domTweet.tweetId)
      .then(fullData => {
        // 3. 将完整数据返回给 background
        // 保持数据结构兼容: isThread 等字段可能需要从 DOM 判断，或者默认 false
        // 这里我们简单处理：如果是 Thread，inject.js 目前只返回单条。
        // 为了兼容 Thread 下载，我们暂且把 fullData 包装进 tweets 数组
        
        // 修正: 保持 extractThreadData 的结构，但用 fullData 覆盖内容
        // 只有当 fullData 有值时才覆盖
        const result = {
          ...domTweet, // 保留 thread 结构信息
          author: fullData.author || domTweet.author, // 优先使用 React 数据，否则回退
          date: fullData.date || domTweet.date,
          // 更新主推文内容
          tweets: domTweet.tweets.map(t => {
            if (t.tweetId === fullData.tweetId) {
              return {
                ...t,
                content: fullData.content || t.content, // 只有非空才覆盖
                // 对于 Article 类型，图片已内嵌在 content 中，不使用单独的 images 数组
                images: fullData.isArticle ? [] : ((fullData.images && fullData.images.length > 0) ? fullData.images : t.images),
                hasVideo: fullData.hasVideo,
                videoUrl: fullData.videoUrl
              };
            }
            return t;
          })
        };
        sendResponse({ success: true, data: result });
      })
      .catch(err => {
        console.error("React数据提取失败，降级使用DOM数据:", err);
        // 如果注入提取失败，降级返回 DOM 提取的数据
        sendResponse({ success: true, data: domTweet });
      });
      
    return true; // Async response

  } else if (request.action === "showToast") {
    showToast(request.message, request.type);
    sendResponse({ success: true });
  }

  return true;
});

// ==================== 数据提取 (通过注入脚本) ====================

function fetchTweetDataFromPage(tweetId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("获取推文数据超时"));
    }, 5000);

    function handler(event) {
      if (event.source !== window || !event.data || event.data.type !== "TWEET_DATA_RESULT") {
        return;
      }
      if (event.data.tweetId !== tweetId) {
         return;
      }

      window.removeEventListener("message", handler);
      clearTimeout(timeout);

      if (event.data.success) {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data.error || "未知错误"));
      }
    }

    window.addEventListener("message", handler);

    window.postMessage({
      type: "FETCH_TWEET_DATA_FROM_PAGE",
      tweetId: tweetId
    }, "*");
  });
}

// ==================== 视频地址提取 (API) - 已废弃，由 fetchTweetDataFromPage 接管 ====================
// function fetchVideoUrl... (Removed)

// ==================== Toast提示 ====================

function showToast(message, type = "success") {
  const existing = document.getElementById('tweet-saver-toast');
  if (existing) existing.remove();

  let bgColor, icon;
  if (type === "success") {
    bgColor = "#00ba7c";
    icon = "✅";
  } else if (type === "info") {
    bgColor = "#1da1f2";
    icon = "⏳";
  } else {
    bgColor = "#e0245e";
    icon = "❌";
  }
  
  const toast = document.createElement('div');
  toast.id = 'tweet-saver-toast';
  toast.innerHTML = `
    <div style="position:fixed;top:20px;right:20px;background:${bgColor};color:white;padding:16px 24px;border-radius:8px;z-index:999999;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:10px;animation:slideIn 0.3s ease;">
      <span style="font-size:20px;">${icon}</span>
      <span>${message}</span>
    </div>
    <style>
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

// ==================== 推文提取 ====================

function extractThreadData() {
  console.log("开始提取推文...");
  
  let mainTweet = findTweetElement();
  if (!mainTweet) {
    mainTweet = document.querySelector('article');
  }
  
  if (!mainTweet) {
    return null;
  }
  
  const authorInfo = extractAuthorFromTweet(mainTweet);
  if (!authorInfo.author) {
    console.log("无法找到作者");
    return null;
  }
  
  console.log("作者:", authorInfo.author);
  
  // 收集该作者的所有推文（排除"发现更多"区域）
  const allArticles = document.querySelectorAll('article');
  const threadTweets = [];
  const seenIds = new Set();
  
  for (const article of allArticles) {
    if (isInDiscoverSection(article)) continue;
    
    const tweetInfo = extractAuthorFromTweet(article);
    if (tweetInfo.author === authorInfo.author) {
      const singleTweet = extractSingleTweet(article);
      if (singleTweet && singleTweet.tweetId && !seenIds.has(singleTweet.tweetId)) {
        seenIds.add(singleTweet.tweetId);
        threadTweets.push(singleTweet);
      }
    }
  }
  
  console.log("找到推文数:", threadTweets.length);
  
  // 按时间排序
  threadTweets.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  return {
    author: authorInfo.author,
    url: threadTweets.length > 0 ? threadTweets[0].url : "",
    tweetId: threadTweets.length > 0 ? threadTweets[0].tweetId : "",
    date: threadTweets.length > 0 ? threadTweets[0].date : "",
    isThread: threadTweets.length > 1,
    tweets: threadTweets
  };
}

// 检查是否在"发现更多"区域
function isInDiscoverSection(article) {
  const articleRect = article.getBoundingClientRect();
  const headers = document.querySelectorAll('h2');
  
  for (const header of headers) {
    const text = (header.textContent || "").trim();
    if (text === "发现更多" || text === "Discover more" || 
        text.startsWith("源自于整个") || text === "你可能感兴趣的推文") {
      const headerRect = header.getBoundingClientRect();
      if (headerRect.bottom < articleRect.top) {
        let hasOtherHeader = false;
        for (const otherHeader of headers) {
          const otherRect = otherHeader.getBoundingClientRect();
          if (otherRect.top > headerRect.bottom && otherRect.bottom < articleRect.top) {
            hasOtherHeader = true;
            break;
          }
        }
        if (!hasOtherHeader) return true;
      }
    }
  }
  
  return false;
}

// 从推文元素中提取作者
function extractAuthorFromTweet(article) {
  const result = { author: "" };
  
  const avatarLink = article.querySelector('a[href^="/"][role="link"] img[src*="profile_images"]');
  if (avatarLink) {
    const link = avatarLink.closest('a[href^="/"]');
    if (link) {
      const href = link.getAttribute("href");
      if (href && href.match(/^\/[a-zA-Z0-9_]+$/)) {
        result.author = href.substring(1);
        return result;
      }
    }
  }
  
  const userLinks = article.querySelectorAll('a[href^="/"][role="link"]');
  for (const link of userLinks) {
    const href = link.getAttribute("href");
    if (href && !href.includes("/status/") && !href.includes("/search") && 
        !href.includes("/hashtag") && !href.includes("/i/") && 
        !href.includes("/lists") && !href.includes("/followers") &&
        href.match(/^\/[a-zA-Z0-9_]+$/)) {
      const span = link.querySelector('span');
      if (span) {
        result.author = href.substring(1);
        return result;
      }
    }
  }
  
  const authorLinks = article.querySelectorAll('a[href^="/"]');
  for (const link of authorLinks) {
    const href = link.getAttribute("href");
    if (href && !href.includes("/status/") && !href.includes("/search") && 
        !href.includes("/hashtag") && !href.includes("/i/") && href.match(/^\/[a-zA-Z0-9_]+$/)) {
      result.author = href.substring(1);
      break;
    }
  }
  
  return result;
}

// 提取单条推文
function extractSingleTweet(article) {
  const data = {
    content: "",
    date: "",
    url: "",
    tweetId: "",
    images: []
  };
  
  // 用于记录已在正文中提取的图片，防止重复
  const embeddedImages = new Set();

  // 提取推文内容（保留链接格式，并尝试内嵌图片）
  const contentElement = article.querySelector('[data-testid="tweetText"]');
  if (contentElement) {
    // 传递 embeddedImages Set 给提取函数
    data.content = extractTweetContent(contentElement, embeddedImages);
  }
  
  const timeElement = article.querySelector("time");
  if (timeElement) {
    data.date = timeElement.getAttribute("datetime") || timeElement.innerText;
  }
  
  const linkElements = article.querySelectorAll('a[href*="/status/"]');
  for (const link of linkElements) {
    const href = link.getAttribute("href");
    if (href && href.includes("/status/")) {
      const match = href.match(/\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
      if (match) {
        data.tweetId = match[2];
        data.url = `https://x.com${href.split("?")[0].split("/photo")[0].split("/video")[0]}`;
        break;
      }
    }
  }
  
  const imageElements = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
  const domImages = Array.from(imageElements).map(img => {
    let src = img.getAttribute("src");
    if (src.includes("?")) {
       // 尝试获取高质量图片
       const baseUrl = src.split("?")[0];
       src = `${baseUrl}?format=jpg&name=large`;
    }
    return src;
  });

  // 过滤掉已经在正文中出现的图片
  data.images = domImages.filter(imgUrl => {
      // 检查该 URL 是否已被标记为嵌入
      // 注意：需要模糊匹配，因为 embeddedImages 里存的可能是处理过的 URL
      return !Array.from(embeddedImages).some(embedded => 
          embedded.split("?")[0] === imgUrl.split("?")[0]
      );
  });

  // 提取视频/GIF封面
  const videoElements = article.querySelectorAll('video');
  if (videoElements.length > 0) {
    data.hasVideo = true;
    const posters = Array.from(videoElements)
      .map(v => v.getAttribute("poster"))
      .filter(p => p);
    
    posters.forEach(poster => {
      // 避免重复添加相同的图片
      const posterBase = poster.split("?")[0];
      if (!data.images.some(img => img.includes(posterBase)) && 
          !Array.from(embeddedImages).some(img => img.includes(posterBase))) {
         data.images.push(poster);
      }
    });
  }

  // 检查 YouTube 等外部视频 (iframe 或 卡片链接)
  const iframe = article.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
  if (iframe) {
    data.hasVideo = true;
    data.videoUrl = iframe.src;
  }

  if (!data.hasVideo) {
    const cardWrapper = article.querySelector('[data-testid="card.wrapper"]');
    if (cardWrapper) {
       // 1. Check for Video Links (Youtube etc)
       const cardLinks = cardWrapper.querySelectorAll('a');
       for (const link of cardLinks) {
          const href = link.getAttribute('href');
          if (href && (href.includes("youtube.com") || href.includes("youtu.be"))) {
            data.hasVideo = true;
            data.videoUrl = href;
            break;
          }
       }

       // 2. If no video found, check for generic Link Card (Image + Link)
       if (!data.hasVideo) {
          // Usually the first anchor is the main link, and the first image is the preview
          const cardLink = cardWrapper.querySelector('a');
          const cardImg = cardWrapper.querySelector('img');
          
          if (cardLink && cardImg) {
             data.card = {
                url: cardLink.getAttribute('href'),
                image: cardImg.getAttribute('src')
             };
          }
       }
    }
  }
  
  return data;
}

// 提取推文内容，保留链接格式，支持内嵌图片
function extractTweetContent(element, embeddedImages = new Set()) {
  let result = '';
  
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // 纯文本节点
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      
      if (tagName === 'img') {
        const src = node.getAttribute('src');
        // 检查是否为媒体图片
        if (src && src.includes('pbs.twimg.com/media')) {
            let cleanSrc = src;
            if (src.includes('?')) {
                const baseUrl = src.split("?")[0];
                cleanSrc = `${baseUrl}?format=jpg&name=large`;
            }
            result += `\n\n![Image](${cleanSrc})\n\n`;
            embeddedImages.add(cleanSrc);
        } else {
            // 表情符号
            const alt = node.getAttribute('alt') || '';
            result += alt;
        }
      } else if (tagName === 'a') {
        // 链接元素
        const href = node.getAttribute('href') || '';
        const text = node.textContent || '';
        
        // 处理Twitter的t.co短链接
        if (href.startsWith('https://t.co/') || href.startsWith('http://t.co/')) {
          // t.co链接，使用显示的文本作为链接文字，但尝试获取真实URL
          const realUrl = node.getAttribute('data-expanded-url') || 
                          node.title || 
                          href;
          // 如果显示文本像是截断的URL（如 github.com/xxx...），使用完整URL
          if (text.includes('…') || text.endsWith('...')) {
            result += realUrl;
          } else {
            result += text.startsWith('http') ? text : realUrl;
          }
        } else if (href.startsWith('/hashtag/')) {
          // Hashtag
          result += text;
        } else if (href.startsWith('/')) {
          // @用户名
          result += text;
        } else {
          // 其他外部链接
          result += href || text;
        }
      } else if (tagName === 'br') {
        // 换行
        result += '\n';
      } else if (tagName === 'span' || tagName === 'div') {
        // 递归处理嵌套元素
        result += extractTweetContent(node, embeddedImages);
      } else {
        // 其他元素，提取文本
        result += node.textContent || '';
      }
    }
  }
  
  return result;
}

// 查找推文元素
function findTweetElement() {
  const hoveredElements = document.querySelectorAll(":hover");
  
  for (let i = hoveredElements.length - 1; i >= 0; i--) {
    const el = hoveredElements[i];
    let article = el.tagName === "ARTICLE" ? el : el.closest('article');
    if (article && !isInDiscoverSection(article)) {
      return article;
    }
  }
  
  const articles = document.querySelectorAll('article');
  const mainArticles = Array.from(articles).filter(a => !isInDiscoverSection(a));
  
  if (mainArticles.length === 0) {
    return articles.length > 0 ? articles[0] : null;
  }
  
  const viewportCenter = window.innerHeight / 2;
  
  for (const article of mainArticles) {
    const rect = article.getBoundingClientRect();
    if (rect.top < viewportCenter && rect.bottom > viewportCenter) {
      return article;
    }
  }
  
  for (const article of mainArticles) {
    const rect = article.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < window.innerHeight) {
      return article;
    }
  }
  
  return mainArticles[0];
}

console.log("X2MD content script loaded");
