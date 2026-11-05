# Yeni Doğan Bakım Akademisi

Yenidoğan bakımı eğitim videoları için hazırlanmış, giriş korumalı web platformu.
Kullanıcılar konu konu videoları izler, ilerlemeleri otomatik kaydedilir; yönetici
panelinden kullanıcılar, konular, videolar ve ilerleme raporları yönetilir.

- **Teknoloji:** Node.js (harici paket yok) + saf HTML/CSS/JavaScript
- **Veri:** `data/data.enc` — AES-256-GCM ile şifreli dosya
- **Şifreler:** PBKDF2 (salt + 120.000 tur) ile hashlenir
- **Oturumlar:** Bellek içi, `HttpOnly` + `SameSite=Lax` çerez
- **Giriş koruması:** IP bazlı hatalı deneme sınırı (8 hatalı deneme / 10 dakika, `lib/security.js`)

## Kurulum ve çalıştırma

```bash
npm start
```

Varsayılan adres: <http://127.0.0.1:3000>

Farklı port/host için:

```bash
set PORT=3001 && npm start
set HOST=0.0.0.0 && npm start   # ağdaki diğer cihazlardan erişim
```

Linux/macOS'ta aynı değişkenler:

```bash
PORT=3001 npm start
HOST=0.0.0.0 npm start
YDW_SECRET="uzun-rastgele-anahtar" npm start   # anahtarı dosya yerine ortamdan ver
```

> İlk çalıştırmada `data/secret.key` ve `data/data.enc` otomatik oluşturulur.
> **`data/secret.key` yedeklenmezse veriler geri getirilemez.** Bu dosyayı ve
> `data/data.enc` dosyasını birlikte yedekleyin, `secret.key` dosyasını kimseyle paylaşmayın.

## İlk giriş

| Kullanıcı adı | Şifre       | Yetki     |
| ------------- | ----------- | --------- |
| `admin`       | `Admin1234!`| Yönetici  |

> ⚠️ **İlk girişten hemen sonra şifreyi değiştirin.** Ana sayfadaki
> "Şifremi değiştir" kartını kullanabilirsiniz. Bu şifre tüm kurulumlarda aynıdır.

Yeni kullanıcılar (anneler) yönetici panelinden oluşturulur; kendi kendilerine kayıt olamazlar.

## Sayfalar

| Sayfa            | Açıklama                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `/index.html`    | Giriş ekranı                                                          |
| `/dashboard.html`| Konu kartları, genel ilerleme, şifre değiştirme                       |
| `/topic.html`    | Bir konunun videoları ve konu ilerlemesi                              |
| `/watch.html`    | Video oynatıcı, izleme sayacı, sonraki/önceki video                   |
| `/progress.html` | Konu bazlı ilerleme tablosu                                           |
| `/admin.html`    | Yönetim paneli (genel bakış, kullanıcılar, konular, videolar, rapor)  |

## Video ekleme

Yönetici paneli → **Videolar** sekmesinden video eklenir. Desteklenen bağlantılar:

- **Google Drive:** `https://drive.google.com/file/d/<ID>/view` → otomatik olarak `/preview`
  adresine çevrilir. Dosya "Bağlantıya sahip olan herkes" olarak paylaşılmalıdır.
- **OneDrive / SharePoint:** `embed` bağlantıları doğrudan gömülür; `1drv.ms` kısa
  bağlantıları gömülü oynatmayı desteklemeyebilir.
- **YouTube / Vimeo:** İzleme bağlantıları embed adresine çevrilir.
- **Doğrudan dosya:** `.mp4`, `.webm`, `.ogg` bağlantıları HTML5 oynatıcı ile oynatılır.

### İzleme takibi nasıl çalışır?

- **Doğrudan dosya** videolarında oynatma süresi gerçek zamanlı ölçülür; video
  duraklatıldığında, sekme arka plana geçtiğinde sayaç durur.
- **Gömülü (iframe) videolarda** tarayıcı güvenliği nedeniyle oynatma durumu okunamaz.
  Bu yüzden video yanındaki **"İzlemeye başladım"** düğmesine basıldığında sayaç başlar;
  sekme arka plana geçtiğinde durur.
- İlerleme 15 saniyede bir ve video duraklatıldığında sunucuya kaydedilir.
- Bir video, süresinin **%90'ı** (yönetici panelinden değiştirilebilir) izlendiğinde
  tamamlanmış sayılır.

## İnternete açık sunucuya kurulum (hosting)

Bu proje **tek bir Node.js süreci** + **diskte tutulan şifreli bir dosya** ile çalışır.
Veritabanı sunucusu, PHP, derleme adımı veya ek npm paketi gerekmez.

### Sunucuda olması gerekenler

| Gereksinim | Minimum | Önerilen |
| --- | --- | --- |
| İşlemci | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 1 GB |
| Disk | 5 GB | 20 GB (yedeklerle) |
| Trafik | Aylık birkaç GB | Videolar gömülü olduğu için düşük |
| Node.js | 18 LTS | 20 / 22 LTS |
| İşletim sistemi | Linux (Ubuntu 22.04/24.04 LTS) | Ubuntu LTS + systemd |
| Ağ | Sabit IP, 80/443 portları | Alan adı + Let's Encrypt |

### Kritik kısıtlar (bu kodun mimarisinden gelen)

1. **Kalıcı ve yazılabilir disk şart.** Tüm veri `data/` klasöründe:
   `secret.key`, `data.enc`, `data.enc.bak`. Geçici (ephemeral) dosya sistemli
   platformlarda (ör. ücretsiz PaaS, konteynerin sıfırlanan diski) **her yeniden
   başlatmada veri kaybolur**. Kalıcı volume/disk bağlanmalı.
2. **Tek süreç (single instance).** Oturumlar bellekte tutulur (`SessionStore`).
   `pm2 cluster`, Docker replika, yük dengeleyici ile çoklu kopya **çalışmaz**:
   kullanıcı bir kopyaya giriş yaparken diğerinde oturumu bulamaz.
   `pm2 start server.js` (fork modu) veya `systemd` ile **tek** süreç çalıştırın.
3. **Yeniden başlatma = tüm kullanıcılar çıkar.** Oturumlar bellekte olduğu için
   güncelleme/restart sonrası herkes yeniden giriş yapar (12 saatlik TTL).
4. **`secret.key` yedeklenmezse veri kurtarılamaz.** `data.enc` tek başına işe
   yaramaz. İkisini birlikte, şifreli bir yedekleme alanına kopyalayın.
   Alternatif olarak anahtar `YDW_SECRET` ortam değişkeniyle verilebilir.
5. **HTTPS'i Node sonlandırmaz.** Uygulama düz HTTP dinler; TLS için önüne
   Caddy / Nginx / platform TLS koyun. `HOST=127.0.0.1` bırakıp yalnızca ters
   vekil sunucudan erişim verin.
6. **Oturum çerezinde `Secure` bayrağı yok** (`HttpOnly; SameSite=Lax`).
   Bu yüzden HTTP üzerinden de gönderilebilir; siteyi mutlaka HTTPS'e yönlendirin
   ve HSTS başlığı ekleyin. (İsteğe bağlı: `YDW_COOKIE_SECURE=1` desteği eklenebilir.)
7. **Giriş sınırı `X-Forwarded-For` başlığına güvenir.** Ters vekil arkasında doğru
   çalışır; uygulama doğrudan internete açılırsa bu başlık taklit edilerek sınır
   atlatılabilir. Bu nedenle doğrudan `0.0.0.0:3000` açmayın.

### Kurulması gereken programlar (Ubuntu örneği)

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Ters vekil + otomatik HTTPS (Nginx yerine Caddy önerilir: sertifika otomatik)
sudo apt install -y caddy

# Güvenlik duvarı ve yedekleme araçları
sudo apt install -y ufw rsync
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

- **Zorunlu:** Node.js 18+ (npm ile birlikte gelir).
- **Zorunlu değil:** MySQL/PostgreSQL, PHP, Apache modülleri, derleyici araçları,
  Redis, Docker (isteğe bağlı), video depolama (videolar dış servislerde).
- **Süreç yöneticisi:** `systemd` (aşağıdaki örnek) veya `pm2` (**fork/tek süreç**).
- **Yedekleme:** `cron` + `rsync`/`restic` ile `data/` klasörü.

### systemd servis örneği

`/etc/systemd/system/yenidogan.service`:

```ini
[Unit]
Description=Yeni Dogan Bakim Akademisi
After=network.target

[Service]
Type=simple
User=yenidogan
WorkingDirectory=/srv/yenidogan-web
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=TZ=Europe/Istanbul
# Environment=YDW_SECRET=uzun-rastgele-bir-anahtar
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ReadWritePaths=/srv/yenidogan-web/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yenidogan
sudo systemctl status yenidogan
```

### Caddy ters vekil örneği

`/etc/caddy/Caddyfile`:

```
akademi.ornek.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "same-origin"
    }
    reverse_proxy 127.0.0.1:3000
}
```

### Günlük yedek (cron)

```bash
# sudo crontab -e
0 3 * * * rsync -a --delete /srv/yenidogan-web/data/ /var/backups/yenidogan/ && \
          tar czf /var/backups/yenidogan-$(date +\%F).tar.gz -C /var/backups yenidogan
```

> `data/secret.key` ve `data/data.enc` **aynı yedekte** olmalı.

### Hangi barındırma tipi uygun?

| Tip | Uygun mu? | Not |
| --- | --- | --- |
| **VPS** (Hetzner, DigitalOcean, Türk sağlayıcılar) | ✅ En uygun | Tam kontrol, sabit disk, ucuz; sistem bakımı sizde |
| **Yönetilen Node.js hosting** (kalıcı diskli) | ✅ | Node desteği + kalıcı disk/volume şart |
| **PaaS** (Railway, Render, Fly.io) | ⚠️ | Yalnızca **kalıcı volume** eklenirse; ücretsiz planlar genelde uygun değil |
| **Paylaşımlı "web hosting"** (cPanel/PHP) | ❌ | Node.js süreci çalıştırılamaz, disk/port kısıtlı |
| **Sunucusuz (Lambda/Vercel vb.)** | ❌ | Kalıcı dosya sistemi ve uzun ömürlü süreç yok |

### Veri koruma (KVKK) notu

Platformda anne/ bebek bilgileri ve izleme kayıtları tutulur; sağlıkla ilgili veriler
KVKK kapsamında **özel nitelikli** sayılabilir. Canlıya almadan önce: aydınlatma metni
ve açık rıza, veri minimizeasyonu, erişim yetkilerinin sınırlandırılması, yurt içinde
veya uygun veri işleyen sözleşmesi olan bir sağlayıcıda barındırma, düzenli yedek ve
silme politikası planlanmalıdır.

## API özeti

| Metot    | Yol                                          | Yetki  |
| -------- | -------------------------------------------- | ------ |
| `POST`   | `/api/auth/login` `/logout` `/password`      | -/giriş|
| `GET`    | `/api/auth/me`, `/api/me/summary`            | giriş  |
| `GET`    | `/api/topics/:id`, `/api/videos/:id`         | giriş  |
| `POST`   | `/api/progress`                              | giriş  |
| `GET`    | `/api/admin/users` `/topics` `/videos` `/report` | admin |
| `POST`   | `/api/admin/users` `/topics` `/videos`       | admin  |
| `PATCH`  | `/api/admin/users/:id` `/topics/:id` `/videos/:id` `/settings` | admin |
| `DELETE` | `/api/admin/users/:id` `/topics/:id` `/videos/:id` | admin |
| `POST`   | `/api/admin/users/:id/reset-progress`        | admin  |

## Test

```bash
npm test            # uctan uca duman testi (gecici port 3111, veriyi degistirir)
npm run check:html  # HTML etiket denetimi
```

> `npm test` sunucuyu geçici portta çalıştırır, `test.anne` adında bir kullanıcı
> oluşturup siler ve ayarları varsayılana döndürür. Üretim verisinde çalıştırmayın.

## Klasör yapısı

```
server.js            HTTP sunucusu, statik dosya + API yönlendirme
lib/store.js         Şifreli veri deposu, konu/video/ilerleme mantığı
lib/security.js      PBKDF2, AES-256-GCM, oturumlar, giriş sınırı
lib/api.js           REST API işleyicileri
lib/video.js         Video sağlayıcı algılama ve embed adresi üretimi
public/              HTML sayfaları, css/style.css, js/*.js
data/                secret.key, data.enc, data.enc.bak (yedekleyin!)
scripts/             Duman testi ve HTML denetimi
analiz.md            Gereksinim analizi
```

## Güvenlik notları

- Uygulama yerel/küçük ekip kullanımı için tasarlandı. İnternete açmadan önce
  HTTPS arkasına (ör. ters vekil sunucu) alın, `HOST=127.0.0.1` bırakın.
- Tüm dinamik metinler arayüzde `textContent` / kaçış fonksiyonu ile basılır.
- Sunucu, `/api` dışındaki tüm yolları `public/` klasörüyle sınırlar.
- Bu platform tıbbi tavsiye yerine geçmez; acil durumlarda hekiminize başvurun.
