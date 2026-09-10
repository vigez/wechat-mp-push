// ============================================================
// 微信草稿推送 Worker —— 免服务器推送公众号草稿
//
// 凭证模式：AppID / AppSecret 存 Worker 环境变量，调用方请求体不携带。
//
// 部署方式（二选一）：
//   A. Cloudflare 控制台粘贴：Workers & Pages → Create Worker
//      → 全选默认模板整段覆盖为本文件 → Save and Deploy。
//   B. wrangler CLI：npx wrangler deploy（环境变量用 secret 配，见 README）。
//
// 环境变量：
//   WECHAT_APPID     公众号 AppID（必填）
//   WECHAT_APPSECRET 公众号 AppSecret（必填）
//   DRAFT_API_KEY    接口鉴权密钥（可选，调用带 X-API-Key 头或 ?key= 参数）
//
// 前置条件（详见 README）：
//   1. 公众号「IP 白名单」必须改为 Cloudflare 全部 IPv4 段（Worker 出口 IP 不固定）。
//   2. 若调微信被 HTTP 403 / error 1010 拦，去 zone 的 Security → Bots
//      关掉「Bot Fight Mode」和「浏览器完整性检查（Browser Integrity Check）」。
// ============================================================

const WX_BASE = 'https://api.weixin.qq.com';

let _token = null;
let _tokenExp = 0;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function dataUriToBlob(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUri);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function urlToBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('下载图片失败: ' + url + ' (' + resp.status + ')');
  return resp.blob();
}

function formDataFile(field, blob, filename) {
  const fd = new FormData();
  fd.append(field, blob, filename);
  return fd;
}

class WeChat {
  constructor(appid, secret) {
    this.appid = appid;
    this.secret = secret;
  }

  async getToken() {
    const now = Date.now();
    if (_token && now < _tokenExp) return _token;
    const resp = await fetch(`${WX_BASE}/cgi-bin/stable_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: this.appid,
        secret: this.secret,
        force_refresh: false,
      }),
    });
    const data = await resp.json();
    if (!data.access_token) throw new Error('获取 token 失败: ' + JSON.stringify(data));
    _token = data.access_token;
    _tokenExp = now + 7000 * 1000;
    return _token;
  }

  async uploadTempImage(blob) {
    const token = await this.getToken();
    const fd = formDataFile('media', blob, 'img.png');
    const resp = await fetch(`${WX_BASE}/cgi-bin/media/uploadimg?access_token=${token}`, {
      method: 'POST',
      body: fd,
    });
    const data = await resp.json();
    if (!data.url) throw new Error('上传正文图失败: ' + JSON.stringify(data));
    return data.url;
  }

  async uploadMaterial(blob) {
    const token = await this.getToken();
    const fd = formDataFile('media', blob, 'cover.png');
    const resp = await fetch(`${WX_BASE}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
      method: 'POST',
      body: fd,
    });
    const data = await resp.json();
    if (!data.media_id) throw new Error('上传封面素材失败: ' + JSON.stringify(data));
    return data.media_id;
  }

  async localizeImages(html) {
    const re = /<img\s+[^>]*?src="([^"]+)"[^>]*?>/gi;
    const srcs = [];
    let m;
    while ((m = re.exec(html)) !== null) srcs.push(m[1]);
    for (const src of srcs) {
      if (src.startsWith('https://mmbiz.qpic.cn') || src.startsWith('http://mmbiz.qpic.cn')) continue;
      let blob = null;
      try {
        if (src.startsWith('data:')) blob = dataUriToBlob(src);
        else if (/^https?:\/\//.test(src)) blob = await urlToBlob(src);
      } catch (e) {
        continue;
      }
      if (blob) {
        try {
          const wxUrl = await this.uploadTempImage(blob);
          html = html.split(src).join(wxUrl);
        } catch (e) { /* 忽略单张 */ }
      }
    }
    return html;
  }

  async resolveCover(cover, content) {
    if (cover) {
      let blob = null;
      if (cover.startsWith('data:')) blob = dataUriToBlob(cover);
      else if (/^https?:\/\//.test(cover)) blob = await urlToBlob(cover);
      if (blob) return await this.uploadMaterial(blob);
    }
    const m = /<img\s+[^>]*?src="([^"]+)"[^>]*?>/i.exec(content);
    if (m) {
      const src = m[1];
      let blob = null;
      if (src.startsWith('data:')) blob = dataUriToBlob(src);
      else if (/^https?:\/\//.test(src)) blob = await urlToBlob(src);
      if (blob) return await this.uploadMaterial(blob);
    }
    return null;
  }

  async addDraft(article) {
    const token = await this.getToken();
    const resp = await fetch(`${WX_BASE}/cgi-bin/draft/add?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articles: [article] }),
    });
    const data = await resp.json();
    if (data.errcode) throw new Error('draft/add 失败: ' + JSON.stringify(data));
    return data.media_id;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'wx-draft-worker' });
    }
    if (url.pathname !== '/api/draft') return json({ code: 1, msg: 'not found' }, 404);
    if (request.method !== 'POST') return json({ code: 1, msg: 'method not allowed' }, 405);

    const KEY = env.DRAFT_API_KEY || '';
    if (KEY && url.searchParams.get('key') !== KEY && request.headers.get('X-API-Key') !== KEY) {
      return json({ code: 1, msg: '未授权' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ code: 1, msg: 'invalid json' }, 400); }

    const { title, author, digest, content, cover } = body;
    if (!title || !content) return json({ code: 1, msg: 'title 和 content 必填' }, 400);

    // 微信凭证：从 Worker 环境变量读取
    const appid = env.WECHAT_APPID || '';
    const secret = env.WECHAT_APPSECRET || '';
    if (!appid || !secret) {
      return json({ code: 1, msg: '缺少 WECHAT_APPID / WECHAT_APPSECRET 环境变量' }, 400);
    }

    const wx = new WeChat(appid, secret);
    try {
      const finalContent = await wx.localizeImages(content);
      const thumb_media_id = await wx.resolveCover(cover, finalContent);
      if (!thumb_media_id) return json({ code: 1, msg: '缺少封面图（cover 或正文第一张图都不存在）' }, 400);
      const media_id = await wx.addDraft({
        title,
        author: author || '',
        digest: digest || '',
        content: finalContent,
        thumb_media_id,
        content_source_url: body.content_source_url || '',
        need_open_comment: body.need_open_comment ? 1 : 0,
        only_fans_can_comment: body.only_fans_can_comment ? 1 : 0,
      });
      return json({ code: 0, media_id });
    } catch (e) {
      return json({ code: 1, msg: String(e.message || e) }, 500);
    }
  },
};
