# 用户授权机制

Bangumi 使用 OAuth 2.0 [ authorization code grant type](https://tools.ietf.org/html/rfc6749#section-4.1) 进行用户验证，如果你对这种验证方式有所了解，可以直接查看对应的 API。

## 实现状态（2026-08-10）

| API 流程                                | 实现状态       | 说明                                                    |
| --------------------------------------- | -------------- | ------------------------------------------------------- |
| 手动输入 Access Token                   | ✅ 已实现      | 用户复制粘贴 Token 到任务窗格                           |
| 测试 Token 有效性 (`/v0/me`)            | ✅ 已实现      | 点击「测试」按钮同时验证 + 刷新用户信息 + 查询有效期    |
| 查询 Token 状态 (`/oauth/token_status`) | ✅ 已实现      | 显示剩余天数/小时，分级颜色预警（绿/黄/橙/红）          |
| 过期提醒（Toast）                       | ✅ 已实现      | <3天红色警告、3-7天黄色预警、已过期强制提示             |
| 授权码流程 (`authorization_code`)       | ⏳ 待实现 (P3) | 需先在 Bangumi 注册应用获取 `client_id`/`client_secret` |
| Refresh Token 自动续期                  | ⏳ 待实现 (P2) | 依赖 P3 获取 `refresh_token`                            |

> **当前交互模型**：用户点击「测试」→ 自动完成 Token 验证 + 用户信息刷新 + 剩余天数显示，原「续约」按钮已合并到测试功能。

---

```

+----------+
| Resource |
|   Owner  |
|          |
+----------+
^
|
(B)
+----|-----+          Client Identifier      +---------------+
|         -+----(A)-- & Redirection URI ---->|               |
|  User-   |                                 | Authorization |
|  Agent  -+----(B)-- User authenticates --->|     Server    |
|          |                                 |               |
|         -+----(C)-- Authorization Code ---<|               |
+-|----|---+                                 +---------------+
|    |                                          ^      v
(A)  (C)                                        |      |
|    |                                          |      |
^    v                                          |      |
+---------+                                     |      |
|         |>---(D)-- Authorization Code --------'      |
|  Client |          & Redirection URI                 |
|         |                                            |
|         |<---(E)----- Access Token ------------------'
+---------+       (w/ Optional Refresh Token)

Note: The lines illustrating steps (A), (B), and (C) are broken into
two parts as they pass through the user-agent.

Figure 3: Authorization Code Flow
```

## 用户验证流程

验证流程为：

1. 第三方应用引导用户访问 Bangumi 授权页获取授权 ⏳ (P3)
2. Bangumi 返回 `code`（验证代码）并跳转至第三方应用 ⏳ (P3)
3. 第三方应用使用 `code`（验证代码）换取 Access Token ⏳ (P3)
4. 使用 Access Token 访问 API ✅ 已实现（用户手动粘贴 Token 后直接使用）

**注意用户验证使用的 Base URL 与 API 不同**

---

### 1. 第三方应用引导用户访问 Bangumi 授权页获取授权

```
GET https://bgm.tv/oauth/authorize
```

| Parameter     | Type   | Desc     | Note                                   | Required |
| ------------- | ------ | -------- | -------------------------------------- | -------- |
| client_id     | string | App ID   | 注册应用时获取                         | ☑️       |
| response_type | string | 验证类型 | 目前仅支持 `code`                      | ☑️       |
| redirect_uri  | string | 回调 URL | 在后台设置的回调地址                   |          |
| scope         | string | 请求权限 | 尚未实现                               |          |
| state         | string | 随机参数 | 随机生产的参数，便于开发者防止跨站攻击 |          |

### 2.Bangumi 返回 `code`（验证代码）并跳转至第三方应用

用户授权后，Bangumi 将会跳转回第三方应用提供的回调地址， 如 [https://sample.com/callback?code=`CODE`]。`code` 的有效期为 60 秒。

### 3. 第三方应用使用 `code`（验证代码）换取 Access Token

使用返回的的 `code` 换取 Access Token

```
POST https://bgm.tv/oauth/access_token
```

| Parameter     | Type   | Desc       | Note                                   | Required |
| ------------- | ------ | ---------- | -------------------------------------- | -------- |
| grant_type    | string | 授权方式   | 此处应使用 `authorization_code`        | ☑️       |
| client_id     | string | App ID     | 注册应用时获取                         | ☑️       |
| client_secret | string | App Secret | 注册应用时获取                         | ☑️       |
| code          | string | 验证代码   | 回调获取的 `code`                      | ☑️       |
| redirect_uri  | string | 回调 URL   | 在后台设置的回调地址                   | ☑️       |
| state         | string | 随机参数   | 随机生产的参数，便于开发者防止跨站攻击 |          |

返回

```json
{
    "access_token":"YOUR_ACCESS_TOKEN",
    "expires_in":604800,
    "token_type":"Bearer",
    "scope":null,
    "refresh_token":"YOUR_REFRESH_TOKEN"
    "user_id" : USER_ID
}
```

### 4.使用 Access Token 访问 API

在 HTTP Header 中通过 Authorization Header 携带 Access Token 信息访问需要授权的 API：

```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

例如在 curl 中设置 Authorization Header

```
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" http://api.chobits.sai.cc/collection/1
```

**注意**

新的 API(`/v0/`) 不再允许使用 query string 传递 Access Token

## 授权有效期刷新

在 `/oauth/access_token` API 的返回中，我们提供了 Refresh Token 以便第三方应用延续 Access Token 的有效期

```
POST https://bgm.tv/oauth/access_token
```

| Parameter     | Type   | Desc          | Note                       | Required |
| ------------- | ------ | ------------- | -------------------------- | -------- |
| grant_type    | string | 授权方式      | 此处应使用 `refresh_token` | ☑️       |
| client_id     | string | App ID        | 注册应用时获取             | ☑️       |
| client_secret | string | App Secret    | 注册应用时获取             | ☑️       |
| refresh_token | string | Refresh Token | 之前获取的 refresh token   | ☑️       |
| redirect_uri  | string | 回调 URL      | 在后台设置的回调地址       | ☑️       |

将会返回新的 access_token 与 refresh_token

```json
{
  "access_token": "YOUR_NEW_ACCESS_TOKEN",
  "expires_in": 604800,
  "token_type": "Bearer",
  "scope": null,
  "refresh_token": "YOUR_NEW_REFRESH_TOKEN"
}
```

## 查询授权信息 ✅ 已实现

获取当前 Access Token 的相关信息。

**在本项目中**：调用 `POST /oauth/token_status` 查询 Token 剩余有效期，结果用于：

1. **UI 显示**：任务窗格 Token 区域显示「Token 有效期: 6天12小时后过期」
2. **分级预警**：
   - 🟢 绿色 (normal)：>7 天正常
   - 🟡 黄色 (warning)：3-7 天预警
   - 🟠 橙色 (danger)：<3 天紧急
   - 🔴 红色 (expired)：已过期
3. **Toast 提醒**：过期/即将过期时弹出 Toast 通知
4. **触发时机**：点击「测试」按钮成功验证 Token 后自动查询
5. **离线容错**：网络失败时读取本地缓存的 `expires` 时间戳

```
POST https://bgm.tv/oauth/token_status
```

| Parameter    | Type   | Desc         | Note                    | Required |
| ------------ | ------ | ------------ | ----------------------- | -------- |
| access_token | string | Access Token | 之前获取的 Access Token | ☑️       |

返回

```json

{
    "access_token":"YOUR_ACCESS_TOKEN",
    "client_id":"YOUR_CLIENT_ID",
    "expires": 1520323182
    "scope":null,
    "user_id" : USER_ID
}
```
