// item-icon.js —— 统一的条目图标渲染
// 规则（用户明确要求）：有贴图用贴图；没有贴图时用「文字首字 + 哈希底色」替代，绝不显示空白或裸键名。
import { h, clear } from '../core/util.js';
import { hashColor, initials } from '../core/registry.js';

/**
 * 渲染一个条目图标方块。
 * @param {object} e    条目（{id,name,icon,iconLoader}）
 * @param {number} size 边长 px
 * @returns {HTMLElement} 固定尺寸的容器，内部会异步替换为贴图
 */
export function itemIcon(e, size = 34) {
  const box = h('div', {
    style: {
      width: `${size}px`, height: `${size}px`, flex: `0 0 ${size}px`,
      borderRadius: `${Math.round(size / 4)}px`, overflow: 'hidden',
      display: 'grid', placeItems: 'center', imageRendering: 'pixelated',
    },
  });

  const fallback = () => {
    clear(box);
    box.appendChild(h('div', {
      style: {
        width: '100%', height: '100%', display: 'grid', placeItems: 'center',
        background: hashColor(e.id), color: '#fff',
        fontSize: `${Math.max(10, Math.round(size * 0.38))}px`, fontWeight: '700',
        letterSpacing: '0', lineHeight: '1',
      },
      title: e.name || e.id,
      text: initials(e.name || e.id),
    }));
  };

  const putImg = (src) => {
    clear(box);
    box.appendChild(h('img', {
      src, alt: e.name || e.id, loading: 'lazy',
      style: { width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' },
      onerror: fallback,
    }));
  };

  if (e.icon) putImg(e.icon);
  else if (e.iconLoader) {
    if (e.__blobUrl) putImg(e.__blobUrl);
    else {
      box.appendChild(h('div', { style: { width: '100%', height: '100%', background: 'var(--subtle-tertiary, rgba(128,128,128,.16))' } }));
      if (!e.__loading) {
        e.__loading = true;
        e.iconLoader().then((url) => {
          e.__loading = false;
          if (!url) { fallback(); return; }
          e.__blobUrl = url;
          putImg(url);
        }).catch(() => { e.__loading = false; fallback(); });
      }
    }
  } else fallback();

  return box;
}
