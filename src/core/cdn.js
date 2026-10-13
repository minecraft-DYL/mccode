// cdn.js —— jsDelivr 端点选择，registry.js 与 registry-cache.js 共用。
//
// 为什么单独抽一个文件：registry.js 需要在加载前选端点，registry-cache.js 的
// probeVersionHasAssets 也要拼同样的地址。原先 registry-cache.js 为了避开
// 「registry.js ←→ registry-cache.js」的循环依赖，把地址构造复制了一行
// （注释写着「此处重复一行以避免循环依赖」）—— 复制就会漂移：加了多端点回退之后，
// 探测那条路径仍然在打已经死掉的 cdn.jsdelivr.net。
// 两边都只依赖本文件，就没有循环，也没有第二份真相。
//
// 实测背景（本机）：`cdn.jsdelivr.net` 的 TLS 被重置（ERR_CONNECTION_RESET），
// 同时 `raw.githubusercontent.com` 也不可达；但同源的 CNAME 端点仍然好用：
//   fastly.jsdelivr.net → 411697 B / 1904 ms
//   gcore.jsdelivr.net  → 411697 B / 3460 ms
// 三个端点路径与 CORS 行为完全一致，所以选中一个之后 fetch 与 <img src> 可以共用。

import { store as ls } from './util.js';

export const ASSET_REPO = 'InventivetalentDev/minecraft-assets';

export const CDN_HOSTS = [
  'https://cdn.jsdelivr.net',
  'https://fastly.jsdelivr.net',
  'https://gcore.jsdelivr.net',
];

const CDN_HOST_KEY = 'cdnHost';
let cdnHost = ls.get(CDN_HOST_KEY, '') || '';

/** 当前生效的 CDN 端点 */
export function currentCdnHost() { return cdnHost || CDN_HOSTS[0]; }

/** 拼一个 jsDelivr gh 通道地址 */
export function cdnGh(ver, path) {
  return `${currentCdnHost()}/gh/${ASSET_REPO}@${encodeURIComponent(ver)}/${path}`;
}

/**
 * 探一个可达的端点并记住它（写 localStorage，下次启动直接命中、不再探测）。
 * 探针用 ~100 B 的 stone.json，不要拿 411 KB 的 en_us.json 当探针。
 */
export async function resolveCdnHost({ force = false } = {}) {
  if (cdnHost && !force) return cdnHost;
  const saved = ls.get(CDN_HOST_KEY, '');
  const order = saved && CDN_HOSTS.includes(saved)
    ? [saved, ...CDN_HOSTS.filter((h) => h !== saved)]
    : CDN_HOSTS.slice();
  for (const h of order) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(`${h}/gh/${ASSET_REPO}@1.20.4/assets/minecraft/models/item/stone.json`, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) { cdnHost = h; ls.set(CDN_HOST_KEY, h); return h; }
    } catch { /* 不可达就换下一个 */ }
  }
  cdnHost = CDN_HOSTS[0];
  return cdnHost;
}
