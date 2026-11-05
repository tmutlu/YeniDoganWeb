'use strict';

/**
 * Video linklerini (Google Drive / OneDrive / dogrudan dosya / YouTube)
 * sayfaya gomulebilecek hale getiren yardimcilar.
 */

function detectProvider(url) {
  const value = String(url || '').trim();
  if (!value) return 'link';
  if (/drive\.google\.com|docs\.google\.com/i.test(value)) return 'drive';
  if (/onedrive\.live\.com|1drv\.ms|sharepoint\.com/i.test(value)) return 'onedrive';
  if (/youtu\.be|youtube\.com/i.test(value)) return 'youtube';
  if (/vimeo\.com/i.test(value)) return 'vimeo';
  if (/\.(mp4|webm|ogg|ogv|m4v|mov)(\?|#|$)/i.test(value)) return 'file';
  return 'link';
}

function driveEmbedUrl(url) {
  const fileMatch = url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  let id = fileMatch ? fileMatch[1] : '';
  if (!id) {
    try {
      const parsed = new URL(url);
      id = parsed.searchParams.get('id') || '';
    } catch (_) {
      id = '';
    }
  }
  if (!id) return null;
  return `https://drive.google.com/file/d/${id}/preview`;
}

function oneDriveEmbedUrl(url) {
  if (/onedrive\.live\.com\/embed/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    const resid = parsed.searchParams.get('resid') || parsed.searchParams.get('id');
    const authkey = parsed.searchParams.get('authkey') || '';
    if (resid) {
      return `https://onedrive.live.com/embed?resid=${encodeURIComponent(resid)}${
        authkey ? `&authkey=${encodeURIComponent(authkey)}` : ''
      }`;
    }
  } catch (_) {
    /* gecersiz URL */
  }
  return null;
}

function youtubeEmbedUrl(url) {
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/watch\?[^#]*v=([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return `https://www.youtube.com/embed/${match[1]}`;
  }
  const idMatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (idMatch) return `https://www.youtube.com/embed/${idMatch[1]}`;
  return null;
}

function vimeoEmbedUrl(url) {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? `https://player.vimeo.com/video/${match[1]}` : null;
}

/**
 * @returns {{provider:string, kind:'iframe'|'video'|'link', embedUrl:string, note:string}}
 */
function resolveVideo(url) {
  const value = String(url || '').trim();
  const provider = detectProvider(value);

  if (provider === 'drive') {
    const embedUrl = driveEmbedUrl(value);
    if (embedUrl) {
      return {
        provider,
        kind: 'iframe',
        embedUrl,
        note: 'Google Drive dosyası "Bağlantıya sahip olan herkes" olarak paylaşılmalıdır.',
      };
    }
    return { provider, kind: 'link', embedUrl: value, note: 'Drive linki tanınamadı, bağlantı olarak açılır.' };
  }

  if (provider === 'onedrive') {
    const embedUrl = oneDriveEmbedUrl(value);
    if (embedUrl) {
      return {
        provider,
        kind: 'iframe',
        embedUrl,
        note: 'OneDrive dosyası "Görüntüleme" izniyle paylaşılmalıdır.',
      };
    }
    return {
      provider,
      kind: 'iframe',
      embedUrl: value,
      note: 'OneDrive kısa linki (1drv.ms) gömülü oynatmayı desteklemeyebilir; "embed" linki kullanmanız önerilir.',
    };
  }

  if (provider === 'youtube') {
    const embedUrl = youtubeEmbedUrl(value);
    return {
      provider,
      kind: embedUrl ? 'iframe' : 'link',
      embedUrl: embedUrl || value,
      note: '',
    };
  }

  if (provider === 'vimeo') {
    const embedUrl = vimeoEmbedUrl(value);
    return {
      provider,
      kind: embedUrl ? 'iframe' : 'link',
      embedUrl: embedUrl || value,
      note: '',
    };
  }

  if (provider === 'file') {
    return { provider, kind: 'video', embedUrl: value, note: '' };
  }

  return { provider: 'link', kind: 'iframe', embedUrl: value, note: 'Bilinmeyen video sağlayıcısı, doğrudan gömülür.' };
}

module.exports = { resolveVideo, detectProvider };
