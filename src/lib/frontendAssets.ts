/** Compare the shell's fingerprinted entry files, not revisions: a CSS hotfix can keep its commit. */
export function frontendAssets(urls: string[], base: string): string | null {
  const origin = new URL(base).origin;
  const assets = urls.flatMap(value => {
    try {
      const url = new URL(value, base);
      return url.origin === origin && url.pathname.startsWith("/assets/") && /\.(?:js|css)$/.test(url.pathname) ? [url.pathname + url.search] : [];
    } catch { return []; }
  });
  return assets.length ? [...new Set(assets)].sort().join("\n") : null;
}

export function shellAssets(shell: Document, base: string): string | null {
  return frontendAssets([...shell.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[type="module"][src], link[rel="stylesheet"][href]')]
    .map(element => element.getAttribute("src") ?? element.getAttribute("href") ?? ""), base);
}

/** Never treat an offline response, login page, or development shell as an update. */
export function assetsChanged(loaded: string | null, served: string | null): boolean {
  return loaded !== null && served !== null && loaded !== served;
}
