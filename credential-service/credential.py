import mitmproxy.http
import mitmproxy.ctx
import json
from urllib.parse import urlparse, parse_qs
import time
from typing import Optional
from bs4 import BeautifulSoup


def first_text(soup, selectors):
    for selector in selectors:
        node = soup.select_one(selector)
        if not node:
            continue
        value = node.get("content") if node.name == "meta" else node.get_text(strip=True)
        if value and value.strip():
            return value.strip()
    return None


def first_attribute(soup, selectors, attributes):
    for selector in selectors:
        node = soup.select_one(selector)
        if not node:
            continue
        for attribute in attributes:
            value = node.get(attribute)
            if value and value.strip():
                return value.strip()
    return None


class ExtractWxCredentials:
    def __init__(self):
        self.cookies = {}

    def load(self, loader):
        loader.add_option(
            name="credentials",
            typespec=Optional[str],
            default=None,
            help="指定 Credentials.json 文件路径",
        )

    def response(self, flow: mitmproxy.http.HTTPFlow):
        # 检查请求的 URL 是否符合过滤器
        parsed_url = urlparse(flow.request.url)
        print(parsed_url)
        if parsed_url.path == '/s' and parsed_url.query.startswith("__biz="):
            # 提取 __biz 参数
            print(f'命中请求')
            query_params = parse_qs(parsed_url.query)
            biz = query_params.get('__biz', [None])[0]
            if biz:
                # 提取响应头中的 Set-Cookie 数据
                set_cookie_header = flow.response.headers.get("Set-Cookie")

                # 提取 HTML 中的信息
                name = None
                avatar = None
                if flow.response.content:
                    try:
                        soup = BeautifulSoup(flow.response.content, 'html.parser')
                        name = first_text(
                            soup,
                            [
                                '.wx_follow_nickname',
                                '#js_name',
                                'meta[property="og:article:author"]',
                                'meta[name="author"]',
                            ],
                        )
                        avatar = first_attribute(
                            soup,
                            [
                                '.wx_follow_avatar > img.wx_follow_avatar_pic',
                                'img.wx_follow_avatar_pic',
                                '#js_profile_qrcode_img',
                            ],
                            ['src', 'data-src'],
                        )
                    except Exception as e:
                        print(f"Error parsing HTML: {e}")

                if set_cookie_header:
                    previous = self.cookies.get(biz, {})
                    self.cookies[biz] = {
                        "biz": biz,
                        "name": name or previous.get("name"),
                        "avatar": avatar or previous.get("avatar"),
                        "url": flow.request.url,
                        "set_cookie": set_cookie_header,
                        "timestamp": int(time.time() * 1000),
                    }
                    # 将 cookies 数据保存到文件中
                    if mitmproxy.ctx.options.credentials:
                        with open(mitmproxy.ctx.options.credentials, "w", encoding="utf-8") as file:
                            json.dump(list(self.cookies.values()), file, indent=4, ensure_ascii=False)

addons = [
    ExtractWxCredentials(),
]
