function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function looksLikeHtml(source: string): boolean {
  return /<(?:!doctype|html|head|body|script|style|div|span|main|section|article|p|h[1-6]|canvas|svg|form|input|button)\b/i.test(
    source,
  );
}

function looksLikeJson(source: string): boolean {
  const trimmed = source.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function wrapHtmlBody(body: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    #app { width: 100%; height: 100%; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderAsText(source: string, title: string): string {
  return wrapHtmlBody(
    `<main style="padding: 14px;">
      <h2 style="margin: 0 0 10px; font-size: 14px; opacity: 0.9;">${escapeHtml(title)}</h2>
      <pre style="white-space: pre-wrap; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.4;">${escapeHtml(source)}</pre>
    </main>`,
    title,
  );
}

function renderAsJavaScript(source: string, title: string): string {
  const sourceLiteral = JSON.stringify(source).replace(/<\/script/gi, "<\\/script");
  return wrapHtmlBody(
    `<div id="app"></div>
<script>
  (function () {
    var showError = function (err) {
      var message = (err && err.message) ? err.message : String(err);
      var stack = (err && err.stack) ? "\\n\\n" + err.stack : "";
      document.body.innerHTML =
        '<main style="padding:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">' +
        '<h2 style="margin:0 0 10px;font-size:13px;color:#fca5a5;">Sandbox script error</h2>' +
        '<pre style="margin:0;white-space:pre-wrap;line-height:1.4;color:#fecaca;">' +
        message.replace(/[&<>]/g, function (ch) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[ch]; }) +
        stack.replace(/[&<>]/g, function (ch) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[ch]; }) +
        '</pre></main>';
    };
    try {
      var source = ${sourceLiteral};
      var fn = new Function(source);
      fn.call(window);
    } catch (err) {
      showError(err);
    }
  })();
</script>`,
    title,
  );
}

export function buildSandboxSrcDoc(
  rawSource: string | null | undefined,
  title = "Sandbox",
): string {
  const source = String(rawSource || "");
  const trimmed = source.trim();

  if (!trimmed) {
    return wrapHtmlBody(
      `<main style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.7;font-size:13px;">No app content.</main>`,
      title,
    );
  }

  if (looksLikeHtml(trimmed)) {
    if (/<!doctype|<html\b/i.test(trimmed)) {
      return source;
    }
    return wrapHtmlBody(source, title);
  }

  if (looksLikeJson(trimmed)) {
    return renderAsText(source, title);
  }

  return renderAsJavaScript(source, title);
}
