# wechat-mp-push-worker

一个跑在 **Cloudflare Workers** 上的微信公众号草稿推送服务。免服务器、免备案、长期有效，把「动态 IP 白名单」这个长期痛点彻底解决。

你只管把「标题 + 作者 + 摘要 + 正文 + 封面」POST 到 `/api/draft`，剩下的取 token、传封面、转正文图、建草稿全部自动完成。

---
如果 wechat-mp-push 对您有所帮助，欢迎赞助项目，支持服务器运行和后续开发。
当然，不赞助也完全不影响使用。分享项目、提交反馈或贡献代码，同样是非常宝贵的支持。


---
## 为什么用它

运营公众号想用脚本推送文章到草稿箱，最烦的就是微信后台的 **IP 白名单**。家里或公司是动态 IP，网络一换 IP 一变，接口直接报 `40164`，文章推不出去，每次都要去后台改白名单。

Cloudflare Workers 是 serverless、全球边缘、境外域名免备案，正好长期稳定。代价只有一条：**IP 白名单要从「单台 IP」扩成「Cloudflare 全部网段」**（下面会列全）。

| 方案 | 运维 | 备案 | IP 白名单 | 有效期 |
|------|------|------|-----------|--------|
| 微信云托管 | 免 | 测试域名免 | 免（私有链路） | ⚠️ 测试域名有有效期，要续期 |
| 自建服务器 | 自己管 | 境外免 | 单 IP | 长期 |
| **Cloudflare Workers** | **免** | **境外免** | **Cloudflare 全段** | **长期** |

---

## 功能特性

- ✅ 自动获取并缓存 `access_token`（用官方推荐的 `stable_token` 接口，不占常规 token 次数配额）
- ✅ 自动上传封面图，拿 `thumb_media_id`（草稿接口强制要求封面）
- ✅ 正文里的外链图 / Base64 图自动转存到微信域名
- ✅ 一行接口建草稿 `POST /api/draft`
- ✅ `X-API-Key` / `?key=` 简单鉴权，防止别人乱推
- ✅ 纯原生 JS，无任何依赖、无构建步骤，控制台粘贴即部署

---

## 快速开始

### 1. 部署（控制台粘贴，无需装环境）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → 选 **Workers** → 填名字（如 `wx-draft-worker`）→ **Create Worker**
2. 进入在线代码编辑器，全选默认模板，**整段粘贴 `worker.js` 内容覆盖** → **Save and Deploy**
3. 进入该 Worker → **Settings → Variables and Secrets**，添加环境变量：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `WECHAT_APPID` | ✅ | 公众号 AppID |
| `WECHAT_APPSECRET` | ✅ | 公众号 AppSecret（建议点 **Encrypt** 加密） |
| `DRAFT_API_KEY` | ❌ | 接口鉴权密钥（建议点 **Encrypt**；不设则接口完全开放） |

4. 加完变量 CF 会提示重新部署，**再点一次 Deploy** 让绑定生效
5. 部署完得到 `https://<你的名字>.<子域>.workers.dev` 域名（可绑定自己的自定义域名）

### 2. 配置 IP 白名单（硬前提，绕不开）

Worker 每次出口 IP 都变，**必须**把公众号白名单从「单台 IP」改成「Cloudflare 全部 IPv4 段」。

路径：公众号后台 → **设置与开发 → 基本配置**（或安全中心）→ **IP 白名单**，粘贴下面 15 段：

```
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

> 若微信提示「不支持该网段位数」（少数账号仅接受 `/8`、`/16`、`/24`），改用混合架构：
> Worker 只做鉴权 + 转发，把请求 POST 到你那台固定 IP 服务器去调微信，白名单只需加你服务器一个 IP。

### 3. 调接口推送

```bash
curl -X POST "https://<你的域名>/api/draft" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的DRAFT_API_KEY" \
  -d '{
    "title": "测试草稿",
    "author": "Su",
    "digest": "一句话摘要",
    "content": "<p>你好，这是来自 Workers 的草稿</p>",
    "cover": "data:image/png;base64,...."
  }'
```

返回 `{"code":0,"media_id":"xxx"}` 即成功，去 `mp.weixin.qq.com → 内容与互动 → 草稿箱` 查看。

---

## API 文档

### `GET /`

健康检查，返回 `{"ok":true,"service":"wx-draft-worker"}`。

### `POST /api/draft`

请求体（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 标题（≤64 字） |
| `content` | string | ✅ | 正文 HTML |
| `author` | string | ❌ | 作者 |
| `digest` | string | ❌ | 摘要（≤120 字） |
| `cover` | string | ❌ | 封面图：data URI 或图片 URL；不填则用正文第一张图 |
| `content_source_url` | string | ❌ | 「阅读原文」链接 |
| `need_open_comment` | number | ❌ | 是否开启留言，0/1 |
| `only_fans_can_comment` | number | ❌ | 是否仅粉丝可留言，0/1 |

鉴权：若配了 `DRAFT_API_KEY`，需在请求头带 `X-API-Key: <key>` 或在 URL 带 `?key=<key>`。

响应：

```json
{ "code": 0, "media_id": "草稿media_id" }
```

---

## 已知坑：Cloudflare Bot 防护（Free 套餐）

调接口时若返回 `HTTP 403 / error 1010`，是 Cloudflare 把「缺浏览器 UA 的脚本请求」当机器人拦在边缘，请求没进 Worker。

**Free 套餐不能用 WAF Allow/Skip 绕过**（Bot 防护不在 Ruleset Engine 内），唯一正路是关掉两个开关：

> 控制台 → 域名 → **安全性 → 机器人** → 关 **Bot Fight Mode**；
> 同页底部（或 安全性 → 设置）关 **浏览器完整性检查（Browser Integrity Check）**。

或者，调用方（脚本）请求时带上浏览器 UA 头也能通过。

---

## 已知限制

- **未认证的个人订阅号不能自动发布**：`freepublish` 接口返回 `48001`，推到草稿箱后仍需在公众号助手手动点「发表」。这是平台限制，与本项目无关。
- 草稿接口有每日调用上限（`45009`），请勿高频刷。

---

## 项目结构

```
.
├── worker.js    # Worker 源码（单文件，无依赖）
├── LICENSE      # MIT 协议
└── README.md    # 本文档
```

---

## 安全说明

- `WECHAT_APPSECRET`、`DRAFT_API_KEY` 建议在 Cloudflare 控制台用 **Encrypt**（加密）存储。
- `DRAFT_API_KEY` 是「共享密钥」式简单门禁，能挡住 casual 滥用，但不是银行级安全。若需更强防护，可叠加 Cloudflare Access 登录墙。
- 密钥不要写进代码、不要提交到仓库。

---

## License

[MIT](./LICENSE)
