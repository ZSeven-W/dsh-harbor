<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md"><b>Türkçe</b></a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Yüklediğiniz [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) eklentileri için salt okunur bir ayna: her birinin **neler yapabildiğini**, nerelerde **çakıştıklarını** ve son taramadan bu yana **nelerin değiştiğini** gösterir; algılanan her yetenek için incelenebilir kanıt sunar.

Herhangi bir şeyi temizleyip temizlememek size kalır. harbor gerçekleri bildirir; yargılamaz, yüklemelere geçit denetimi uygulamaz ve hiçbir şeyi engellemez.

## Nedir — ne değildir

harbor tek bir şey yapar: yüklediğiniz eklentilerin sürekli güncellenen, kanıt destekli kaydını tutar. Bu kayıt üç bölümden oluşur — envanterin kendisi (algılayıcının bulabildiği yerlerde kaynak konumlarıyla birlikte yüklenmiş her üçüncü taraf eklenti), her eklentinin beyan ettikleriyle kodunun gerçekte yaptıklarının uzlaştırılması ve taramalar arasında nelerin değiştiğinin zaman çizelgesi.

harbor'ın özellikle yapmadıkları da tasarımının eşit derecede önemli bir parçasıdır. Eklentileri yüklenmeden önce incelemez veya engellemez — kabul denetimi eklenti mağazası araçlarının işidir. Upstream bağımlılık izlemeye derinlemesine girmez; upstream denetimi yalnızca eklenti sürümlerini kapsar ve orada biter. Genel kod denetimi yapmaz; eklenti davranışını durdurmaz, engellemez veya sandbox içine almaz.

Bunların sonuncusu bir kapsam kararı değil, host ile ilgili bir gerçektir. DSH'nin Cordis runtime'ında yetenek sandbox'ı yoktur: bir eklenti, host'un ana Node realm'i içinde host ile aynı ayrıcalıklarla çalışır. harbor yetenekleri **görünür** kılabilir, **algılayabilir** ve beyanlarla **uzlaştırabilir** — ancak kapatamaz. Eklenti davranışını sınırlandırmak için DSH loader'ın kendisinde destek gerekir; aşağıdaki beyan akışı da bu standardın soyut tartışmalar yerine verilerle oluşmasını sağlar.

Son olarak harbor puan değil, gerçek bildirir. Çıktısı her zaman “ne algılandı ve kanıt nerede” şeklindedir — hiçbir zaman risk seviyesi veya kalite notu değildir. Bir bulgunun sizin için ne anlama geldiği harbor'ın değil, sizin değerlendirmenizdir.

> **Durum: `0.1.0-rc.1`, sürüm adayı sağlamlaştırılıyor.** CLI, yalnızca loopback hub rotaları, DSH ayarlar paneli, profiller arası sürüm sapması ve isteğe bağlı upstream denetimi kullanılabilir. Canlı bir host runtime araçlarını, provider'ları ve rotaları sağlar; canlı host dışında runtime kanıtı açıkça `available: false` durumuna düşer. Algılayıcılar hâlâ sezgiseldir ve daha geniş ekosisteme göre ayarlanmaktadır; bu nedenle yokluğu kanıt saymak yerine kanıtları inceleyin.

## Neleri inceler

```
~/.dsh/profiles/*                → yüklü üçüncü taraf bundle'ları (npm ve link: aynı şekilde)
  ├─ declared    package.json / cordis.patch.yml — eklentinin kendisi hakkında söyledikleri
  ├─ runtime     host'a gerçekten kaydedilmiş tools / routes / providers
  ├─ static      subprocess, egress, harici config yazımları — file:line ile
  ├─ versions    sapma (yerel, her zaman) + upstream (ağ üzerinden, isteğe bağlı)
  └─ snapshot    önceki taramayla diff: yeni sürümler, yeni yetenekler
        └─ uzlaştırma: beyan edilen dsh.capabilities ile algılananlar
```

Yetenekler on üç öğelik sabit bir kümedir — client injection, realm riskleri, realm kopyaları, global hooks, LLM adaptörleri, subprocesses, ağ egress'i, web rotaları, tool kaydı, MCP sunucuları, harici config yazımları, kimlik bilgisi işleme ve environment okumaları. Kümenin sabit olması, raporların taramalar arasında karşılaştırılabilir ve diff edilebilir kalmasını sağlar. Yetkili liste [SPEC.md](./SPEC.md) §2'de, makinece okunabilir doğruluk kaynağı ise `src/scan/detectors.mjs` dosyasındadır.

Kullanılan ifade özellikle tarafsızdır: risk değil, **yetenek**. Bazı eklentilerin tüm amacı subprocess başlatmaktır. Rapor “bu ne yapabilir” sorusunu yanıtlar, “yapmalı mı” sorusunu size bırakır.

## Sürümler

harbor sürümlerle ilgili iki soruyu yanıtlar ve bunları birbirinden ayrı tutar.

**Profiller arası sapma** tümüyle yereldir. Aynı eklentinin farklı profillerde farklı sürümlerde olması bu makineyle ilgili bir gerçektir; dolayısıyla her taramada ücretsiz olarak hesaplanır. Bir `link:` veya `file:` yüklemesi “en yeni” referans değeri sayılmaz: çalışan bir çalışma ağacının yayımlanmış sürümün önünde olması normaldir, sapma değildir.

**Upstream denetimi** makinenin dışına çıkar, bu nedenle varsayılan taramanın hiçbir zaman parçası değildir. CLI için `harbor scan --check-updates` gerekir; panelde açıkça bir düğmeye basılması gerekir ve düğmenin yanındaki metin bunu belirtir — bu, sayfada makinenizin dışına çıkan tek eylemdir. Her sonuç beş durumdan birine sahiptir:

- **behind** — registry'de daha yeni bir sürüm var
- **current** — yüklü sürüm registry ile eşleşiyor
- **ahead** — yüklü sürüm registry'dekinden daha yeni (bakımcının makinesinde gerçek bir durum)
- **local** — karşılaştırılacak upstream'i olmayan ve hiçbir zaman “güncel” gösterilmeyen bir `link:` / `file:` yüklemesi
- **unknown** — sorgulama başarısız oldu

registry, kendi `.npmrc` dosyanızdan (`@scope:registry` geçersiz kılmaları dâhil) okunur; hiçbir zaman npmjs'e sabitlenmez. Sonuçlar diskte altı saat önbelleğe alınır.

## Kurulum

Yerel geliştirme için bir checkout'tan yükleyin:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin`, kalan argümanları profil dizinindeki pnpm'e iletir; `link:` ise profil bağımlılığını bu checkout'a sembolik bağla bağlar, böylece yeniden derlemeler doğrudan görünür. Registry kurulumu için aday `next` etiketini kullanın:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Yeni profil katmanının yüklenmesi için ardından DSH'yi yeniden başlatın.

Panel, DSH Web UI'da **Settings** altında **DSH Harbor** bölümü olarak görünür — CLI ile aynı aynadır: kanıtlı envanter, çakışmalar, sürümler ve son taramadan bu yana oluşan diff. **Check for updates** düğmesi, bu sayfada makinenizin dışına çıkan tek eylemdir. Panel, eklentinin hub yarısının parçasıdır ve yalnızca web sunucusu bulunan profillerde bağlanır.

Eklentinin çalıştırılabilir dosyası seçilen profil içine yüklenir; eklentiyi `web`'e eklemek `harbor`'ı shell'inizin global `PATH`'ine koymaz. Onu ilgili profil üzerinden çalıştırın:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Bir checkout'tan veya registry üzerinden tek seferlik çalıştırmak için bunun yerine aşağıdakilerden birini kullanın:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Kullanım

Aşağıdaki örneklerde `harbor`, yukarıdaki çalıştırma biçimlerinden birinin kısaltması olarak kullanılır.

```bash
harbor scan                 # envanter, çakışmalar ve son taramadan bu yana değişiklikler
harbor scan --check-updates # + registry'ye karşı isteğe bağlı upstream denetimi (ağ üzerinden)
harbor manifest ./my-plugin # kendi eklentiniz için bir dsh.capabilities bloğu taslağı oluşturun
```

Mevcut `file:line` kaynak kanıtlarını yazdırmak için `--evidence`, makinece okunabilir tam rapor için `--json` ve diff referansının yazılmasını atlamak için `--no-snapshot` ekleyin. Manifest, dosya sistemi veya runtime kaynaklı gerçeklerin kaynak satırı olmayabilir; bunlar uygun şekilde etiketlenir.

Tarayıcı bağımlılık içermez ve DSH'nin yüklü olmasını gerektirmez; bu nedenle CI'da da çalışır.

## Eklenti yazarları için

`harbor manifest`, eklentinizi diğerlerini okuduğu şekilde okur ve `package.json` dosyanızdaki mevcut `dsh` nesnesine birleştirilecek `capabilities` üyesinin taslağını oluşturur; sizden asla bu nesneyi tümüyle değiştirip `bundle` veya `client` yapılandırmasını kaybetmenizi istemez. Beyan yapıldıktan sonra harbor denetimi **beyan edilen ile algılanan** karşılaştırmasına dönüşür: beyan ettiğiniz ama hiç kullanmadığınız yetenekler ayıklayabileceğiniz gürültüdür; algılanan fakat beyan edilmeyen yetenekler ise açıklanmaya değerdir. harbor kendi `dsh.capabilities` değerlerini de beyan eder; dolayısıyla akış aracın kendisinde yeniden üretilebilir: bu depoda `harbor manifest .` komutunu çalıştırın.

Kuralın kendisi [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)) dosyasında yazılıdır. Tek cümleyle: `dsh.capabilities`, `package.json` içinde eklentinizin kodunun gerçekte ne yaptığını belirten düz bir listedir. Bunu beyan etmek kolaydır ve iki kez karşılık verir — harbor gibi denetim araçları sözlerinizi kodunuzla uzlaştırabilir, eklentinizi çalıştıran kişiler de hiçbir şeyi gizlemediğinizi görebilir. Kendi beyanınızı istediğiniz zaman `harbor manifest <dir>` ile denetleyin.

## Sınırlar, açıkça

harbor her eklentinin kaynak kodunu okur; bu da onu ortamdaki en ayrıcalıklı unsur hâline getirir. Kendi raporunda kendisi de görünür.

Upstream denetimi etkinleştirildikten sonra harbor'ın kendisi de ağ egress yeteneğine sahip olur ve bu yetenek zaten `dsh.capabilities` beyanında listelenmiştir.

## Lisans

MIT
