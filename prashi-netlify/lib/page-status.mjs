const pages = {
  404: ['Page not found', 'This page may have moved, or the link may be incorrect.'],
  500: ['Something went wrong', 'Prashi couldn’t load this page. Try again in a moment.'],
  503: ['Temporarily unavailable', 'Prashi can’t reach its database right now. Please try again shortly.'],
};

export function statusPage(status) {
  const [title, description] = pages[status] || pages[500];
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
    <title>${title} · Prashi Tutorial</title><link rel="icon" href="/assets/logo.jpg"><link rel="stylesheet" href="/assets/portal.css">
    <script type="module" src="/assets/transitions.js"></script></head><body>
    <main class="frame status-layout"><article class="panel status-panel"><p class="status-label">${status}</p><h1>${title}</h1>
    <p>${description}</p><a class="course-button action-primary" href="/">Back to Prashi Tutorial</a></article></main>
    <footer class="site-footer"><div class="frame"><button type="button" class="motion-control quiet" data-motion-toggle hidden>Pause animation</button></div></footer>
    </body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      ...(status === 503 ? { 'Retry-After': '30' } : {}) },
  });
}
