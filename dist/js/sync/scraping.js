// ========== 同步收藏模块 ==========
// 功能：从 Bangumi 获取收藏列表并标记到工作表
// 依赖：bangumi.js, syncRecord.js, util.js

// ========== 常量定义 ==========
// 限制常量
const SCRAPING_CONFIG = {
    MAX_PAGES: 10,           // 网页抓取最大页数
    API_MAX_PAGES: 50,        // API 获取最大页数
    REQUEST_DELAY: 1000,     // 抓取请求延迟（毫秒）
    PAGE_SIZE: 30,           // API 每页大小
    MAX_RETRIES: 3,          // 最大重试次数
    RETRY_DELAY: 2000        // 重试延迟（毫秒）
};

// ========== 抓取方式同步（保留旧方式）==========
/**
 * 通过网页抓取方式同步收藏
 * @param {number} sheetIndex - 工作表索引
 */
function syncFromBgmByScraping(sheetIndex) {
    bgmLog(BGM.LOG_LEVELS.DEBUG, "syncFromBgmByScraping 开始");

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Token！");
        return;
    }

    // 选择抓取类型
    _scrapingTypeSelect((types) => {
        if (!types || types.length === 0) {
            showAlertDialog("提示", "请至少选择一种类型！");
            return;
        }

        _scrapingConfirmThenRun(sheetIndex, types, token);
    });
}

/**
 * 类型选择
 * @param {function} callback - 回调函数
 */
function _scrapingTypeSelect(callback) {
    let types = [];
    let checkboxes = document.querySelectorAll(".type-checkbox");
    checkboxes.forEach(cb => {
        if (cb.checked) {
            types.push(cb.value);
        }
    });
    callback(types);
}

/**
 * 确认后执行抓取
 * @param {number} sheetIndex - 工作表索引
 * @param {Array} types - 类型数组
 * @param {string} token - Token
 */
function _scrapingConfirmThenRun(sheetIndex, types, token) {
    showConfirmDialog("将获取选中类型的收藏并标记到工作表，是否继续？", () => {
        _doScrapingSync(sheetIndex, types, token);
    });
}

/**
 * 执行抓取同步
 * @param {number} sheetIndex - 工作表索引
 * @param {Array} types - 类型数组
 * @param {string} token - Token
 */
function _doScrapingSync(sheetIndex, types, token) {
    setSyncRunning(true);
    setStatus("正在获取收藏列表...", "info");

    // 获取用户收藏（网页抓取方式）
    fetchAllUserCollectionsByScraping(token, types, (collections) => {
        if (collections && collections.length > 0) {
            bgmLog(BGM.LOG_LEVELS.INFO, "获取到 " + collections.length + " 条收藏");

            // 标记到工作表
            markUploadedItemsInSheet(sheetIndex, collections);

            // 记录到同步记录
            if (typeof fetchAndRecordBgCollections === 'function') {
                fetchAndRecordBgCollections(token, "", collections);
            }
        } else {
            showAlertDialog("提示", "未获取到收藏数据！");
        }
        setSyncRunning(false);
        setStatus("同步完成", "success");
    }, (error) => {
        showAlertDialog("获取收藏失败", error);
        setSyncRunning(false);
        setStatus("同步失败", "error");
    });
}

// ========== 获取用户所有收藏（网页抓取分页）==========
/**
 * 通过网页抓取获取用户所有收藏
 * @param {string} token - Token
 * @param {Array} types - 类型数组
 * @param {function} onSuccess - 成功回调
 * @param {function} onError - 失败回调
 */
function fetchAllUserCollectionsByScraping(token, types, onSuccess, onError) {
    let userId = _getBgmUserId();
    if (!userId) {
        if (onError) onError("请先设置用户ID！");
        return;
    }

    let allCollections = [];
    let currentPage = 1;
    let maxPages = SCRAPING_CONFIG.MAX_PAGES;

    /**
     * 获取单页收藏
     * 注意：网页抓取方式存在跨域限制，建议使用官方 API (fetchAllUserCollections)
     */
    function fetchPage() {
        setStatus("正在获取第 " + currentPage + " 页...", "info");

        let xhr = new XMLHttpRequest();
        let url = "https://bgm.tv/" + userId + "?tab=collect";

        xhr.open("GET", url, true);
        // 使用 Authorization Header 代替 Cookie，避免 CORS 问题
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");

        xhr.onload = function() {
            if (xhr.status === 200) {
                let collections = parseCollectionPageHTML(xhr.responseText, types);
                allCollections = allCollections.concat(collections);

                // 检查是否有下一页
                if (hasNextPageLink(xhr.responseText) && currentPage < maxPages) {
                    currentPage++;
                    setTimeout(fetchPage, SCRAPING_CONFIG.REQUEST_DELAY); // 使用配置的延迟
                } else {
                    if (onSuccess) onSuccess(allCollections);
                }
            } else if (xhr.status === 403) {
                if (onError) onError("Token 无效或已过期！");
            } else {
                if (onError) onError("获取失败，状态码：" + xhr.status);
            }
        };

        xhr.onerror = function() {
            if (onError) onError("网络请求失败！");
        };

        xhr.send();
    }

    fetchPage();
}

/**
 * 解析收藏页面 HTML
 * @param {string} html - HTML 内容
 * @param {Array} types - 类型数组
 * @returns {Array} 收藏列表
 */
function parseCollectionPageHTML(html, types) {
    let collections = [];

    // 简单的 HTML 解析（实际应用中可能需要更健壮的解析方式）
    try {
        let typeMap = {
            "collect": "已看",
            "watching": "在看",
            "wish": "想看",
            "on_hold": "搁置",
            "dropped": "抛弃"
        };

        // 使用正则匹配条目
        let itemRegex = /<li\s+class="item"\s+data-id="(\d+)".*?<a[^>]*>([^<]+)<\/a>/gs;
        let match;

        while ((match = itemRegex.exec(html)) !== null) {
            let sid = match[1];
            let name = match[2];

            collections.push({
                sid: sid,
                name: name,
                type: "collect",
                rate: ""
            });
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "解析收藏页面失败: " + e.message);
    }

    return collections;
}

/**
 * 检查是否有下一页链接
 * @param {string} html - HTML 内容
 * @returns {boolean} 是否有下一页
 */
function hasNextPageLink(html) {
    return html.includes("page_next") || html.includes("下一页");
}

// ========== API 方式获取收藏 ==========
/**
 * 通过 API 获取用户所有收藏
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @param {function} onSuccess - 成功回调
 * @param {function} onError - 失败回调
 */
function fetchAllUserCollections(token, userId, onSuccess, onError) {
    // 只在调试模式下记录（不在生产环境日志中暴露敏感信息）
    bgmLog(BGM.LOG_LEVELS.DEBUG, "fetchAllUserCollections 开始, userId=" + userId);

    let allCollections = [];
    let page = 1;
    let maxPages = SCRAPING_CONFIG.API_MAX_PAGES;

    /**
     * 获取单页收藏
     */
    function fetchPage() {
        if (page > maxPages) {
            bgmLog(BGM.LOG_LEVELS.WARN, "达到最大页数限制，停止获取");
            if (onSuccess) onSuccess(allCollections);
            return;
        }

        setStatus("正在获取第 " + page + " 页...", "info");

        let xhr = new XMLHttpRequest();
        let offset = (page - 1) * SCRAPING_CONFIG.PAGE_SIZE;
        let url = BGM_CONFIG.API_BASE + "/user/" + userId + "/collection?type=2&offset=" + offset + "&limit=" + SCRAPING_CONFIG.PAGE_SIZE;

        xhr.open("GET", url, true);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    let data = JSON.parse(xhr.responseText);
                    if (data.data && data.data.length > 0) {
                        data.data.forEach(item => {
                            allCollections.push({
                                sid: String(item.subject_id),
                                name: item.subject ? item.subject.name : "",
                                type: item.type,
                                rate: item.rate || "",
                                tags: item.tags || [],
                                comment: item.comment || "",
                                lastModified: item.lastmodified
                            });
                        });

                        page++;
                        setTimeout(fetchPage, BGM_CONFIG.REQUEST_DELAY);
                    } else {
                        // 没有更多数据
                        bgmLog(BGM.LOG_LEVELS.INFO, "获取完成，共 " + allCollections.length + " 条");
                        if (onSuccess) onSuccess(allCollections);
                    }
                } catch (e) {
                    bgmLog(BGM.LOG_LEVELS.ERROR, "解析收藏数据失败: " + e.message);
                    if (onError) onError("解析数据失败: " + e.message);
                }
            } else if (xhr.status === 401) {
                if (onError) onError("Token 无效或已过期！");
            } else if (xhr.status === 404) {
                if (onError) onError("用户不存在！");
            } else if (xhr.status === 429) {
                bgmLog(BGM.LOG_LEVELS.WARN, "API 限流，等待后重试...");
                setTimeout(fetchPage, SCRAPING_CONFIG.RETRY_DELAY);
            } else {
                if (onError) onError("获取失败，状态码：" + xhr.status);
            }
        };

        xhr.onerror = function() {
            if (onError) onError("网络请求失败！");
        };

        xhr.send();
    }

    fetchPage();
}

// ========== 从 BGM 获取收藏并写入同步记录表 ==========
/**
 * 获取收藏并记录
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @param {Array} collections - 收藏数据
 */
function fetchBgCollectionRecords(token, userId, collections) {
    if (typeof fetchAndRecordBgCollections === 'function') {
        fetchAndRecordBgCollections(token, userId, collections);
    }
}

/**
 * 选择获取范围
 * @param {function} callback - 回调函数
 */
function _fetchRecordsScopeSelect(callback) {
    // 默认获取所有
    callback({
        startDate: null,
        endDate: null,
        types: null
    });
}

/**
 * 执行获取收藏记录
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 */
function _runFetchBgRecords(token, userId) {
    fetchBgCollectionRecords(token, userId, null);
}

// ========== Promise 风格的 API（解决回调地狱）==========
/**
 * 通过 API 获取用户收藏（Promise 版本）
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @returns {Promise<Array>} 收藏列表
 */
function fetchAllUserCollectionsAsync(token, userId) {
    return new Promise((resolve, reject) => {
        fetchAllUserCollections(token, userId, resolve, reject);
    });
}

/**
 * 通过网页抓取获取用户收藏（Promise 版本）
 * @param {string} token - Token
 * @param {Array} types - 类型数组
 * @returns {Promise<Array>} 收藏列表
 */
function fetchAllUserCollectionsByScrapingAsync(token, types) {
    return new Promise((resolve, reject) => {
        fetchAllUserCollectionsByScraping(token, types, resolve, reject);
    });
}

/**
 * HTTP 请求 Promise 封装
 * @param {string} method - HTTP 方法
 * @param {string} url - 请求 URL
 * @param {object} options - 选项 { headers, body, token }
 * @returns {Promise<{code: number, data: any}>}
 */
function httpRequestAsync(method, url, options = {}) {
    return new Promise((resolve, reject) => {
        const { headers = {}, body, token } = options;
        
        let xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        
        // 设置默认 headers
        xhr.setRequestHeader("Content-Type", "application/json");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
        
        // 设置自定义 headers
        Object.entries(headers).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value);
        });

        xhr.onload = function() {
            try {
                let data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                resolve({ code: xhr.status, data });
            } catch (e) {
                resolve({ code: xhr.status, data: xhr.responseText });
            }
        };

        xhr.onerror = function() {
            reject(new Error("网络请求失败"));
        };

        xhr.send(body ? JSON.stringify(body) : null);
    });
}

// 导出 Promise 版本函数到全局（供外部使用）
if (typeof window !== 'undefined') {
    window.fetchAllUserCollectionsAsync = fetchAllUserCollectionsAsync;
    window.fetchAllUserCollectionsByScrapingAsync = fetchAllUserCollectionsByScrapingAsync;
    window.httpRequestAsync = httpRequestAsync;
}
