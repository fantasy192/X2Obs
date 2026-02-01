// 此脚本注入到页面主世界中运行，可以访问 React Fiber 树

window.addEventListener("message", (event) => {
  // 仅接受来自 content script 的消息
  if (event.source !== window || !event.data || event.data.type !== "FETCH_TWEET_DATA_FROM_PAGE") {
    return;
  }

  const tweetId = event.data.tweetId;
  console.log("[X2MD Inject] Received request for:", tweetId);

  try {
    const tweetData = findTweetDataFromReact(tweetId);
    window.postMessage({
      type: "TWEET_DATA_RESULT",
      success: true,
      data: tweetData,
      tweetId: tweetId
    }, "*");
  } catch (error) {
    console.error("[X2MD Inject] Error:", error);
    window.postMessage({
      type: "TWEET_DATA_RESULT",
      success: false,
      error: error.message,
      tweetId: tweetId
    }, "*");
  }
});

function findTweetDataFromReact(tweetId) {
  // 1. 找到对应的推文元素
  const links = document.querySelectorAll(`a[href*="/status/${tweetId}"]`);
  let article = null;
  
  for (const link of links) {
    const found = link.closest('article');
    if (found) {
      article = found;
      break;
    }
  }

  if (!article) {
    // 尝试查找所有 article
    const articles = document.querySelectorAll('article');
    for (const art of articles) {
        if (art.querySelector(`a[href*="${tweetId}"]`)) {
            article = art;
            break;
        }
    }
  }

  if (!article && document.querySelectorAll('article').length > 0) {
      article = document.querySelector('article'); 
  }

  if (!article) {
    throw new Error("未找到推文 DOM 元素");
  }

  // 2. 获取 React Fiber 实例
  const fiberKey = Object.keys(article).find(k => k.startsWith("__reactFiber$"));
  if (!fiberKey) {
    throw new Error("无法访问 React Fiber 实例");
  }

  const fiber = article[fiberKey];

  // 3. 遍历 Fiber 树查找 Tweet 数据对象
  const tweetRawData = findTweetObjectInFiber(fiber);
  
  if (!tweetRawData) {
    console.error("[X2MD Inject] Fiber traversal failed. Dumping fiber for debug:", fiber);
    throw new Error("React 数据中未找到推文原始数据");
  }

  console.log("[X2MD Inject] Found raw tweet data:", tweetRawData);

  // 4. 解析数据
  return parseTweetData(tweetRawData);
}

function findTweetObjectInFiber(fiber, depth = 0, maxDepth = 50, visited = new Set()) {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return null;
  visited.add(fiber);

  if (fiber.memoizedProps) {
    // 很多时候数据在 memoizedProps.tweet 中
    if (fiber.memoizedProps.tweet) {
      return fiber.memoizedProps.tweet;
    }
    // 有时候在 props.tweet 中
    if (fiber.memoizedProps.props && fiber.memoizedProps.props.tweet) {
        return fiber.memoizedProps.props.tweet;
    }
  }

  if (fiber.return) {
    const res = findTweetObjectInFiber(fiber.return, depth + 1, maxDepth, visited);
    if (res) return res;
  }

  return null;
}

function parseTweetData(tweet) {
  const legacy = tweet.legacy || tweet; // 有时候数据直接在根对象，没有legacy wrapper
  const noteTweet = tweet.note_tweet || legacy.note_tweet;
  const article = tweet.article || legacy.article; // 检查 Article 字段
  
  console.log("[X2MD Inject] Parsing tweet data...");

  // 1. 提取文本
  let fullText = "";
  
  // A. 处理 Twitter Article (长文)
  if (article && article.content_state && article.content_state.blocks) {
    console.log("[X2MD Inject] Found Article data");
    const title = article.title ? `# ${article.title}\n\n` : "";
    const body = article.content_state.blocks.map(b => b.text).join("\n\n");
    fullText = title + body;
  } 
  // B. 处理 Note Tweet (长推文)
  else if (noteTweet && noteTweet.note_tweet_results && noteTweet.note_tweet_results.result) {
    console.log("[X2MD Inject] Found Note Tweet data");
    fullText = noteTweet.note_tweet_results.result.text;
  } 
  // C. 普通推文
  else {
    fullText = legacy.full_text || legacy.text || "";
  }

  // 2. 提取作者
  let author = "";
  let authorName = "";
  
  // 优先检查 core.user_results (GraphQL 结构)
  if (tweet.core?.user_results?.result?.legacy) {
      const user = tweet.core.user_results.result.legacy;
      author = user.screen_name;
      authorName = user.name;
  } 
  // 其次检查直接挂载的 user 对象 (v1.1 或 Article 结构)
  else if (tweet.user) {
      author = tweet.user.screen_name;
      authorName = tweet.user.name;
  }
  // 最后检查 legacy 中的 user_id (通常没有 screen_name)
  else if (legacy.user_id_str) {
      console.warn("[X2MD Inject] User info missing, only ID available");
  }

  // 3. 提取媒体 (图片/视频)
  const images = [];
  let videoUrl = null;
  let hasVideo = false;

  // A. Article 媒体
  if (article) {
    // 封面图
    if (article.cover_media?.media_info?.original_img_url) {
      images.push(article.cover_media.media_info.original_img_url);
    }
    // 文中图片
    if (article.media_entities) {
      article.media_entities.forEach(m => {
        if (m.media_info?.original_img_url) {
          images.push(m.media_info.original_img_url);
        }
      });
    }
  }

  // B. 普通/Note 推文媒体
  const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
  
  mediaEntities.forEach(m => {
    if (m.type === 'photo') {
      images.push(m.media_url_https);
    } else if (m.type === 'video' || m.type === 'animated_gif') {
      hasVideo = true;
      if (m.media_url_https) images.push(m.media_url_https);
      
      if (m.video_info && m.video_info.variants) {
        const mp4Variants = m.video_info.variants
          .filter(v => v.content_type === "video/mp4" && v.bitrate !== undefined)
          .sort((a, b) => b.bitrate - a.bitrate);
        
        if (mp4Variants.length > 0) {
          videoUrl = mp4Variants[0].url;
        }
      }
    }
  });

  return {
    tweetId: legacy.id_str || tweet.id_str, // 兼容直接结构
    author: author,
    authorName: authorName,
    date: legacy.created_at || tweet.created_at,
    content: fullText,
    images: images, // Article 和 Tweet 媒体合并
    hasVideo: hasVideo,
    videoUrl: videoUrl,
    url: `https://x.com/${author || 'i'}/status/${legacy.id_str || tweet.id_str}`
  };
}

console.log("[X2MD] Inject script loaded");
