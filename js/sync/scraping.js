// ========== 同步收藏模块 ==========
// 功能：从 Bangumi API 获取收藏列表并标记到工作表
// 依赖：bangumi.js, syncRecord.js, util.js

// ========== 常量定义 ==========
const SCRAPING_CONFIG = {
    API_MAX_PAGES: 50,        // API 获取最大页数
    PAGE_SIZE: 30,            // API 每页大小
    MAX_RETRIES: 3,          // 最大重试次数
    RETRY_DELAY: 2000        // 重试延迟（毫秒）
};

// ========== API 方式获取收藏 ==========
/**
 * 通过 API 获取用户所有收藏
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @param {function} onSuccess - 成功回调
 * @param {function} onError - 失败回调
 */
function fetchAllUserCollections(token, userId, onSuccess, onError) {
    bgmLog(BGM.LOG_LEVELS.DEBUG, "fetchAllUserCollections 开始, userId=" + userId);

    let allCollections = [];
    let page = 1;
    let maxPages = SCRAPING_CONFIG.API_MAX_PAGES;

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

// ========== Promise 风格 API ==========
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
        
        xhr.setRequestHeader("Content-Type", "application/json");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
        
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

// 导出函数到全局（供其他模块通过 window 访问）
if (typeof window !== 'undefined') {
    window.fetchAllUserCollections = fetchAllUserCollections;
    window.fetchAllUserCollectionsAsync = fetchAllUserCollectionsAsync;
    window.httpRequestAsync = httpRequestAsync;
    window._fetchRecordsScopeSelect = _fetchRecordsScopeSelect;
    window._runFetchBgRecords = _runFetchBgRecords;
}
