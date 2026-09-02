import { getBrowser } from '~/server/utils/puppeteer';

export default defineEventHandler(async event => {
  const html = await readBody<string>(event);
  if (!html || typeof html !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '请求体必须是 HTML 字符串' });
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });

    // page.pdf() 默认会进入打印排版；如果测量时和导出时的 media 不一致，
    // 或图片/字体尚未完成布局，实际内容高度会大于传入的纸张高度，Chromium 就会再分页。
    await page
      .waitForFunction(
        () => Array.from(document.images).every(img => img.complete && img.naturalWidth > 0),
        { timeout: 30_000 }
      )
      .catch(() => undefined);
    await page.evaluate(() => document.fonts?.ready);

    const contentHeight = await page.evaluate(
      // @ts-expect-error runs in browser context
      () =>
        Math.ceil(
          Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.body.getBoundingClientRect().height,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
            document.documentElement.getBoundingClientRect().height
          )
        )
    );

    const pdfBuffer = await page.pdf({
      width: '210mm',
      height: `${contentHeight + 20}px`,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    setResponseHeader(event, 'Content-Type', 'application/pdf');
    return pdfBuffer;
  } finally {
    await page.close();
  }
});
