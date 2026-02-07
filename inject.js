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
  const legacy = tweet.legacy || tweet; 
  const noteTweet = tweet.note_tweet || legacy.note_tweet;
  const article = tweet.article || legacy.article; 
  
  console.log("[X2MD Inject] Parsing tweet data...");

  let fullText = "";
  const images = []; 
  const contentInsertedImages = new Set(); 
  let videoUrl = null;
  let hasVideo = false;

  if (article && article.content_state && article.content_state.blocks) {
    console.log("[X2MD Inject] Found Article data");

    const entityMap = article.content_state.entityMap || {};

    // 1. 构建 mediaId -> URL 的映射
    const mediaIdToUrl = {};

    if (article.media_entities) {
      console.log(`[X2MD Inject] article.media_entities sample:`, Object.values(article.media_entities)[0]);
      Object.values(article.media_entities).forEach(m => {
        const url = m.media_info?.original_img_url;
        if (url) {
          // 存储长 ID（API 格式）
          const longId = m.media_id_str || m.id_str || String(m.id);
          mediaIdToUrl[String(longId)] = url;

          // 同时存储短 ID（纯数字格式）- 从 media_id 字段获取
          if (m.media_id) {
            mediaIdToUrl[String(m.media_id)] = url;
            console.log(`[X2MD Inject] Stored short mediaId: ${m.media_id}`);
          }
        }
      });
    }

    // 添加 cover_media
    if (article.cover_media?.media_info?.original_img_url) {
      const coverId = article.cover_media.media_id_str || 'cover';
      mediaIdToUrl[String(coverId)] = article.cover_media.media_info.original_img_url;
      if (article.cover_media.media_id) {
        mediaIdToUrl[String(article.cover_media.media_id)] = article.cover_media.media_info.original_img_url;
      }
    }

    console.log("[X2MD Inject] mediaIdToUrl:", mediaIdToUrl);
    console.log("[X2MD Inject] entityMap keys:", Object.keys(entityMap));

    // 2. 构建 entityKey -> 内容 的映射
    const entityKeyToContent = {};
    Object.keys(entityMap).forEach(key => {
      const entityWrapper = entityMap[key];
      console.log(`[X2MD Inject] Processing entityMap[${key}]:`, JSON.stringify(entityWrapper, null, 2));

      // entityMap 的结构可能是 {key: "X", value: {...}} 或者直接是 {...}
      const entity = entityWrapper.value || entityWrapper;
      const entityKey = entityWrapper.key || key;

      // Article 的图片 entity type 是 "MEDIA" 而不是 "IMAGE"
      if (entity.type && (entity.type.toUpperCase() === 'IMAGE' || entity.type.toUpperCase() === 'MEDIA')) {
        console.log(`[X2MD Inject] Found ${entity.type} entity, entity.data:`, entity.data);

        // 尝试多种方式获取 mediaId
        let mediaId = entity.data?.mediaId || entity.data?.id || entity.data?.media_id;

        // Article 的 MEDIA entity 中，mediaId 在 mediaItems[0].mediaId
        if (!mediaId && entity.data?.mediaItems && entity.data.mediaItems.length > 0) {
          mediaId = entity.data.mediaItems[0].mediaId;
        }

        console.log(`[X2MD Inject] Extracted mediaId: "${mediaId}"`);

        if (mediaId) {
          // 尝试精确匹配
          let url = mediaIdToUrl[String(mediaId)];

          // 如果没找到，尝试部分匹配
          if (!url) {
            const foundKey = Object.keys(mediaIdToUrl).find(k =>
              k.includes(String(mediaId)) || String(mediaId).includes(k)
            );
            if (foundKey) {
              url = mediaIdToUrl[foundKey];
              console.log(`[X2MD Inject] Found via fuzzy match: mediaId="${mediaId}" matched key="${foundKey}"`);
            }
          }

          if (url) {
            entityKeyToContent[String(entityKey)] = { type: 'IMAGE', content: `![Image](${url})` };
            console.log(`[X2MD Inject] Mapped entity key="${entityKey}" to image: ${url}`);
          } else {
            console.log(`[X2MD Inject] Failed to find URL for mediaId="${mediaId}". Available keys:`, Object.keys(mediaIdToUrl));
          }
        }
      } else if (entity.type === 'LINK') {
        const url = entity.data?.url || entity.data?.href;
        if (url) {
          entityKeyToContent[String(entityKey)] = { type: 'LINK', url: url };
        }
      }
    });

    const title = article.title ? `# ${article.title}\n\n` : "";
    const contentParts = [];

    // 3. 按顺序处理每个 block
    article.content_state.blocks.forEach((block, blockIndex) => {
      const blockType = block.type || 'unstyled';
      const blockText = block.text || "";
      const entityRanges = (block.entityRanges || []).sort((a, b) => a.offset - b.offset);

      console.log(`[X2MD Inject] Block ${blockIndex}: type="${blockType}", text="${blockText.substring(0, 50)}${blockText.length > 50 ? '...' : ''}", entityRanges=${entityRanges.length}`);

      // atomic 块通常是独立的媒体块（图片、视频等）
      if (blockType === 'atomic') {
        entityRanges.forEach(range => {
          const entityContent = entityKeyToContent[String(range.key)];
          if (entityContent && entityContent.type === 'IMAGE') {
            contentParts.push(entityContent.content);
            contentInsertedImages.add(entityContent.content.match(/!\[Image\]\((.*?)\)/)?.[1]);
            console.log(`[X2MD Inject] Added atomic image from entity ${range.key} (type: ${typeof range.key})`);
          }
        });
        return; // atomic 块处理完毕
      }

      // 文本块：需要处理内嵌的 entity
      if (!blockText.trim() && entityRanges.length === 0) {
        return; // 跳过空块
      }

      let textParts = [];
      let lastOffset = 0;

      // 处理 entityRanges
      entityRanges.forEach(range => {
        // 添加 entity 前的文本
        if (range.offset > lastOffset) {
          textParts.push(blockText.slice(lastOffset, range.offset));
        }

        console.log(`[X2MD Inject] Looking up range.key="${range.key}" (type: ${typeof range.key})`);
        const entityContent = entityKeyToContent[String(range.key)];
        console.log(`[X2MD Inject] Lookup result:`, entityContent ? `FOUND (${entityContent.type})` : 'NOT FOUND');
        if (!entityContent) {
          console.log(`[X2MD Inject] Available keys:`, Object.keys(entityKeyToContent));
        }

        if (entityContent) {
          if (entityContent.type === 'IMAGE') {
            // 图片内嵌到文本中
            textParts.push(`\n\n${entityContent.content}\n\n`);
            contentInsertedImages.add(entityContent.content.match(/!\[Image\]\((.*?)\)/)?.[1]);
            console.log(`[X2MD Inject] Added inline image from entity ${range.key}`);
          } else if (entityContent.type === 'LINK') {
            // 链接
            const linkText = blockText.slice(range.offset, range.offset + range.length);
            textParts.push(`[${linkText}](${entityContent.url})`);
          }
        } else {
          // 没有找到对应的 entity，保留原文本
          textParts.push(blockText.slice(range.offset, range.offset + range.length));
        }

        lastOffset = range.offset + range.length;
      });

      // 添加剩余的文本
      if (lastOffset < blockText.length) {
        textParts.push(blockText.slice(lastOffset));
      }

      const finalText = textParts.join('').trim();
      if (finalText) {
        contentParts.push(finalText);
      }
    });

    fullText = title + contentParts.join('\n\n');

    console.log("[X2MD Inject] Total blocks processed:", article.content_state.blocks.length);
    console.log("[X2MD Inject] Content parts:", contentParts.length);
    console.log("[X2MD Inject] Images inserted:", contentInsertedImages.size);
    console.log("[X2MD Inject] Inserted image URLs:", Array.from(contentInsertedImages));

    // 不需要单独的 images 数组，所有图片都应该已经在正文中
  } 
  else if (noteTweet && noteTweet.note_tweet_results && noteTweet.note_tweet_results.result) {
    fullText = noteTweet.note_tweet_results.result.text;
  } 
  else {
    fullText = legacy.full_text || legacy.text || "";
  }

  let author = "";
  let authorName = "";
  if (tweet.core?.user_results?.result?.legacy) {
      const user = tweet.core.user_results.result.legacy;
      author = user.screen_name;
      authorName = user.name;
  } else if (tweet.user) {
      author = tweet.user.screen_name;
      authorName = tweet.user.name;
  }

  if (!article) {
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
          if (mp4Variants.length > 0) videoUrl = mp4Variants[0].url;
        }
      }
    });
  }

  return {
    tweetId: legacy.id_str || tweet.id_str,
    author: author,
    authorName: authorName,
    date: legacy.created_at || tweet.created_at,
    content: fullText,
    images: images,
    hasVideo: hasVideo,
    videoUrl: videoUrl,
    url: `https://x.com/${author || 'i'}/status/${legacy.id_str || tweet.id_str}`,
    isArticle: !!(article && article.content_state) // 标记是否为 Article 类型
  };
}

console.log("[X2MD] Inject script loaded");
