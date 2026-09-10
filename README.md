# wechat-mp-push
一个跑在 Cloudflare Workers 上的微信公众号草稿推送服务。免服务器、免备案、长期有效，把「动态 IP 白名单」这个长期痛点彻底解决。  你只管把「标题 + 作者 + 摘要 + 正文 + 封面」POST 到 `/api/draft`，剩下的取 token、传封面、转正文图、建草稿全部自动完成。 
