/* The real referee pages running inside the overlay preview, on made-up matches. Only
   with ?sandbox in the address: nothing here touches a referee's phone. Everything the
   page asks of /api is answered by the preview page beside it and never leaves the
   browser, and what it remembers stays in this tab, away from real scores waiting to
   send and from the organizer's login. */
if (new URLSearchParams(location.search).has('sandbox')) {
  Object.defineProperty(window, 'localStorage', { get: () => sessionStorage });
  sessionStorage.setItem('ref.pw.demo', 'preview');

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api')) return realFetch(input, options);
    const ask = window.parent === window ? null : window.parent.refRequest;
    const answer = ask
      ? ask(options.method ?? 'GET', url.pathname, options.body)
      : { status: 503, body: JSON.stringify({ detail: 'Open this from the overlay preview' }) };
    return new Response(answer.body, {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
