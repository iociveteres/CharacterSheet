// room.js
(function () {
  const containerSelector = '.character-sheet';
  const linkSelector = 'a[href^="/sheet/view/"]';

  // event delegation for sheet links
  document.addEventListener('click', async (e) => {
    const a = e.target.closest(linkSelector);
    if (!a) return;

    e.preventDefault();
    const url = a.href;
    const container = document.querySelector(containerSelector);
    if (!container) return;

    // optional: show loading state
    container.classList.add('loading');

    try {
      const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Network error: ' + res.status);

      const html = await res.text();
      // html can be a fragment or a full document; parse and insert
      insertHtml(container, html);
      // update URL gracefully (so back button works)
      // history.pushState({ sheetUrl: url }, '', url);
    } catch (err) {
      console.error(err);
      // show error to user
      container.innerHTML = `<div class="error">Failed to load sheet: ${err.message}</div>`;
    } finally {
      container.classList.remove('loading');
    }
  });

  // handle browser back/forward
  window.addEventListener('popstate', (ev) => {
    if (ev.state && ev.state.sheetUrl) {
      // reload sheet URL (could be optimized to cache)
      fetch(ev.state.sheetUrl).then(r => r.text()).then(html => {
        const container = document.querySelector(containerSelector);
        insertHtml(container, html);
      }).catch(console.error);
    }
  });

  // Insert HTML into container and run scripts (external & inline)
  function insertHtml(container, html) {
    // parse the incoming HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // pick children from body (fragment), or from a wrapper if server returns only the fragment
    const newNodes = Array.from(doc.body.childNodes);

    // Remove old content
    container.innerHTML = '';
    // Move non-script nodes into container
    newNodes.forEach(node => {
      if (node.tagName && node.tagName.toLowerCase() === 'script') return;
      container.appendChild(document.importNode(node, true));
    });
    processDeclarativeShadowRoots(container).catch(console.error);

    container.dispatchEvent(new CustomEvent('charactersheet_inserted', {
      bubbles: true
    }));
  }
})();

async function processDeclarativeShadowRoots(container) {
  // find templates inside the container that use declarative shadowroot attribute
  const templates = Array.from(container.querySelectorAll('template[shadowrootmode]'));
  for (const tpl of templates) {
    const mode = tpl.getAttribute('shadowrootmode') || 'open';
    const host = tpl.parentElement;
    if (!host) continue;

    // create shadow root (skip if host already has one)
    if (!host.shadowRoot) {
      try {
        host.attachShadow({ mode });
      } catch (err) {
        // attachShadow might throw under some CSP or older browser — skip gracefully
        console.warn('attachShadow failed', err);
      }
    }
    const shadow = host.shadowRoot || host;

    // Extract nodes from the template content
    const content = tpl.content;
    // collect scripts that are inside the template so we can execute them in the shadow root
    const scripts = Array.from(content.querySelectorAll('script'));

    // move non-script nodes into the shadow root
    Array.from(content.childNodes).forEach(node => {
      if (node.tagName && node.tagName.toLowerCase() === 'script') return;
      shadow.appendChild(document.importNode(node, true));
    });

    // remove the template from the host
    tpl.remove();

    // execute scripts found inside the template (in order)
    for (const s of scripts) {
      if (s.src) {
        await new Promise((resolve, reject) => {
          const scr = document.createElement('script');
          if (s.type) scr.type = s.type;
          scr.src = new URL(s.src, location.href).href;
          // preserve data-* attributes
          for (const attr of s.attributes) if (attr.name.startsWith('data-')) scr.setAttribute(attr.name, attr.value);
          scr.onload = () => resolve();
          scr.onerror = () => reject(new Error('Failed to load shadow script ' + scr.src));
          // append to shadow so script runs in shadow context
          shadow.appendChild(scr);
        }).catch(err => console.error(err));
        // call init afterwards if present on the script tag
        maybeCallInit(s, host);
      } else {
        // inline script: create new script element and append inside shadow
        const inline = document.createElement('script');
        if (s.type) inline.type = s.type;
        for (const attr of s.attributes) if (attr.name.startsWith('data-')) inline.setAttribute(attr.name, attr.value);
        inline.textContent = s.textContent;
        shadow.appendChild(inline);
        maybeCallInit(s, host);
      }
    }
  }
}