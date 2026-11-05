import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "motion/react";
import App from "./App";
import { headTags, origin, pages } from "./seo";

export const publicPaths = pages.map(p => p.path);
export const sitemapUrls = pages.filter(p => p.indexable).map(p => origin + p.path);

export async function renderPage(path: string) {
  const head = renderToStaticMarkup(<>{headTags(path, true).map(({ tag, attrs, text }, i) =>
    createElement(tag, { ...attrs, key: i, "data-seo": "" }, text)
  )}</>);
  if (!publicPaths.includes(path)) {
    const fallback = path === "/404" ? '<main id="main"><h1>Page unavailable</h1><a href="/">Back to Chroma3D</a></main>' : "";
    return { head, body: `<div id="root">${fallback}</div>` };
  }
  const stream = await renderToReadableStream(
    <MotionConfig reducedMotion="user"><App initialPath={path} /></MotionConfig>,
    { onError(error) { throw error; } },
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  return { head, body: `<div id="root" data-path="${path}">${html}</div>` };
}
