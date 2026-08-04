import unittest

from bs4 import BeautifulSoup

from credential import first_attribute, first_text


class CredentialIdentityParsingTest(unittest.TestCase):
    def test_prefers_visible_follow_name(self):
        soup = BeautifulSoup(
            '<span class="wx_follow_nickname">少数派</span><meta name="author" content="备用名称">',
            'html.parser',
        )

        self.assertEqual(
            first_text(
                soup,
                ['.wx_follow_nickname', '#js_name', 'meta[property="og:article:author"]', 'meta[name="author"]'],
            ),
            '少数派',
        )

    def test_falls_back_to_js_name_and_meta_content(self):
        js_name = BeautifulSoup('<strong id="js_name">产品沉思录</strong>', 'html.parser')
        meta_name = BeautifulSoup('<meta property="og:article:author" content="三联生活周刊">', 'html.parser')

        selectors = ['.wx_follow_nickname', '#js_name', 'meta[property="og:article:author"]', 'meta[name="author"]']
        self.assertEqual(first_text(js_name, selectors), '产品沉思录')
        self.assertEqual(first_text(meta_name, selectors), '三联生活周刊')

    def test_reads_avatar_from_src_or_lazy_data_src(self):
        direct = BeautifulSoup('<img class="wx_follow_avatar_pic" src="https://example.com/direct.png">', 'html.parser')
        lazy = BeautifulSoup('<img id="js_profile_qrcode_img" data-src="https://example.com/lazy.png">', 'html.parser')

        self.assertEqual(
            first_attribute(direct, ['img.wx_follow_avatar_pic'], ['src', 'data-src']),
            'https://example.com/direct.png',
        )
        self.assertEqual(
            first_attribute(lazy, ['#js_profile_qrcode_img'], ['src', 'data-src']),
            'https://example.com/lazy.png',
        )


if __name__ == '__main__':
    unittest.main()
