<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md"><b>हिन्दी</b></a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

आपके इंस्टॉल किए हुए [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) प्लगइन का केवल-पढ़ने योग्य दर्पण: हर प्लगइन **क्या कर सकता है**, वे कहाँ **टकराते हैं**, और पिछली स्कैनिंग के बाद **क्या बदला** — हर पहचानी गई क्षमता के लिए जाँचने योग्य साक्ष्य सहित।

कुछ साफ़ करना है या नहीं, यह निर्णय आपका है। harbor तथ्य बताता है; वह न कोई फैसला सुनाता है, न इंस्टॉल को रोकता है और न कुछ इंटरसेप्ट करता है।

## यह क्या है — और क्या नहीं है

harbor केवल एक काम करता है: आपके इंस्टॉल किए हुए प्लगइन की लगातार अद्यतन होने वाली, साक्ष्य-समर्थित बही रखता है। इस बही के तीन हिस्से हैं — स्वयं इन्वेंटरी (हर इंस्टॉल किया हुआ तृतीय-पक्ष प्लगइन, और जहाँ डिटेक्टर पता लगा सके वहाँ स्रोत स्थान), हर प्लगइन के दावे और उसके कोड के वास्तविक व्यवहार का मिलान, तथा स्कैन के बीच हुए बदलावों की समयरेखा।

harbor जानबूझकर क्या नहीं करता, यह भी उसके डिज़ाइन का उतना ही महत्वपूर्ण भाग है। वह इंस्टॉल से पहले प्लगइन की जाँच या प्रवेश-नियंत्रण नहीं करता — यह प्लगइन-मार्केटप्लेस टूलिंग का काम है। वह upstream dependencies की गहरी निगरानी नहीं करता; upstream जाँच केवल प्लगइन संस्करणों तक सीमित रहती है। वह सामान्य कोड ऑडिट नहीं करता, और प्लगइन के व्यवहार को इंटरसेप्ट, ब्लॉक या sandbox नहीं करता।

इनमें आख़िरी बात दायरे का चुनाव नहीं, बल्कि host की वास्तविकता है। DSH के Cordis runtime में capability sandbox नहीं है: प्लगइन host के मुख्य Node realm में host के ही विशेषाधिकारों के साथ चलता है। harbor क्षमताओं को **दृश्यमान** बना सकता है, उन्हें **पहचान** सकता है और declarations से उनका **मिलान** कर सकता है — लेकिन उन्हें बंद नहीं कर सकता। प्लगइन के व्यवहार को सीमित करने के लिए स्वयं DSH loader का सहयोग चाहिए, और नीचे दिया गया declaration flow इसी मानक को अमूर्त बहस की जगह डेटा के आधार पर विकसित करता है।

अंत में, harbor तथ्य बताता है, स्कोर नहीं। उसका आउटपुट हमेशा “क्या पहचाना गया और उसका साक्ष्य कहाँ है” होता है — न जोखिम स्तर, न गुणवत्ता ग्रेड। किसी निष्कर्ष का आपके लिए क्या अर्थ है, यह आपका निर्णय है, harbor का नहीं।

> **स्थिति: `0.1.0-rc.2`, release candidate को मज़बूत किया जा रहा है।** CLI, केवल loopback वाले hub routes, DSH settings panel, cross-profile drift और वैकल्पिक upstream check उपलब्ध हैं। सक्रिय host runtime tools, providers और routes उपलब्ध कराता है; उसके बाहर runtime evidence साफ़ तौर पर `available: false` में बदल जाता है। Detectors अभी heuristic हैं और व्यापक ecosystem के अनुसार calibrate किए जा रहे हैं, इसलिए उनके evidence की समीक्षा करें और किसी चीज़ का न मिलना उसके न होने का प्रमाण न मानें।

## यह क्या देखता है

```
~/.dsh/profiles/*                → इंस्टॉल किए हुए तृतीय-पक्ष bundles (npm और link: दोनों)
  ├─ declared    package.json / cordis.patch.yml — प्लगइन अपने बारे में क्या कहता है
  ├─ runtime     host में वास्तव में register किए गए tools / routes / providers
  ├─ static      subprocess, egress, बाहरी config में लेखन — file:line सहित
  ├─ versions    drift (स्थानीय, हमेशा) + upstream (नेटवर्क, वैकल्पिक)
  └─ snapshot    पिछले scan से diff: नए versions, नई capabilities
        └─ मिलान: घोषित dsh.capabilities बनाम वास्तव में पहचानी गई क्षमताएँ
```

क्षमताएँ तेरह का एक निश्चित समूह हैं — client injection, realm risks, realm copies, global hooks, LLM adapters, subprocesses, network egress, web routes, tool registration, MCP servers, बाहरी config में लेखन, credentials का प्रबंधन और environment reads। समूह निश्चित है ताकि अलग-अलग scan की reports की तुलना और diff किया जा सके। आधिकारिक सूची [SPEC.md](./SPEC.md) §2 में है; machine-readable source of truth `src/scan/detectors.mjs` है।

शब्दावली जानबूझकर तटस्थ है: **क्षमता**, जोखिम नहीं। कुछ प्लगइन का पूरा उद्देश्य ही subprocesses चलाना होता है। रिपोर्ट “यह क्या कर सकता है” का उत्तर देती है और “क्या इसे ऐसा करना चाहिए” आप पर छोड़ती है।

## संस्करण

harbor संस्करणों से जुड़े दो प्रश्नों का उत्तर देता है और उन्हें अलग रखता है।

**Cross-profile drift** पूरी तरह स्थानीय है। अलग-अलग profile में एक ही प्लगइन के अलग संस्करण इस मशीन का तथ्य हैं, इसलिए हर scan में बिना अतिरिक्त लागत के इसकी गणना होती है। `link:` या `file:` install को “सबसे नया” baseline नहीं माना जाता: किसी working tree का प्रकाशित संस्करण से आगे होना सामान्य है, drift नहीं।

**Upstream check** मशीन से बाहर संपर्क करता है, इसलिए default scan का हिस्सा कभी नहीं होता। CLI में `harbor scan --check-updates` देना पड़ता है; panel में स्पष्ट रूप से बटन दबाना पड़ता है और उसके पास लिखा पाठ यह बात बताता है — उस page पर यही एकमात्र action है जो आपकी मशीन से बाहर संपर्क करता है। हर परिणाम पाँच स्थितियों में से एक होता है:

- **behind** — registry में नया संस्करण उपलब्ध है
- **current** — इंस्टॉल किया हुआ संस्करण registry से मेल खाता है
- **ahead** — इंस्टॉल किया हुआ संस्करण registry से नया है (maintainer की मशीन पर यह वास्तविक स्थिति हो सकती है)
- **local** — `link:` / `file:` install, जिसके पास तुलना के लिए upstream नहीं है और जिसे कभी “up to date” नहीं दिखाया जाता
- **unknown** — lookup विफल रहा

registry आपके अपने `.npmrc` से पढ़ी जाती है (`@scope:registry` overrides सहित), इसे कभी npmjs पर hardcode नहीं किया जाता। परिणाम disk पर छह घंटे के लिए cache किए जाते हैं।

## इंस्टॉलेशन

स्थानीय development के लिए checkout से इंस्टॉल करें:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` बाकी arguments को profile directory के भीतर pnpm को भेजता है, और `link:` profile dependency को इस checkout से symlink करता है, इसलिए rebuild सीधे दिखाई देते हैं। registry से इंस्टॉल करते समय candidate `next` tag का उपयोग करें:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

इसके बाद DSH को restart करें ताकि नई profile layer load हो जाए।

Panel, DSH के Web UI में **Settings** के अंतर्गत **DSH Harbor** section के रूप में दिखाई देता है — CLI जैसा ही दर्पण: evidence सहित inventory, conflicts, versions और पिछले scan के बाद का diff। इसका **Check for updates** बटन उस page पर एकमात्र action है जो आपकी मशीन से बाहर संपर्क करता है। Panel प्लगइन के hub वाले भाग में है, जो केवल web server वाले profiles में mount होता है।

प्लगइन का executable चुने हुए profile के भीतर इंस्टॉल होता है; उसे `web` में जोड़ने से `harbor` आपके shell के global `PATH` में नहीं आता। इसे उस profile के माध्यम से चलाएँ:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

checkout से या registry के जरिए एक बार चलाने के लिए इनमें से किसी एक का उपयोग करें:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## उपयोग

नीचे के उदाहरणों में `harbor` ऊपर दिए गए invocation forms में से किसी एक का संक्षिप्त रूप है।

```bash
harbor scan                 # inventory, conflicts और पिछले scan के बाद के बदलाव
harbor scan --check-updates # + registry के विरुद्ध वैकल्पिक upstream check (networked)
harbor manifest ./my-plugin # अपने प्लगइन के लिए dsh.capabilities block का draft बनाएँ
```

उपलब्ध `file:line` source evidence दिखाने के लिए `--evidence`, पूरी machine-readable report के लिए `--json`, और diff baseline लिखना छोड़ने के लिए `--no-snapshot` जोड़ें। Manifest, filesystem या runtime से मिले तथ्यों में source line न हो सकती है और उन्हें उसी अनुसार label किया जाता है।

Scanner dependency-free है और इसे DSH इंस्टॉल होने की आवश्यकता नहीं है, इसलिए यह CI में भी चलता है।

## प्लगइन लेखकों के लिए

`harbor manifest` आपके प्लगइन को उसी तरह पढ़ता है जैसे अन्य सभी प्लगइन को, और आपके `package.json` के मौजूदा `dsh` object में merge करने के लिए `capabilities` member का draft बनाता है; वह पूरे object को बदलकर `bundle` या `client` configuration खोने के लिए कभी नहीं कहता। Declaration के बाद harbor की जाँच **declared बनाम detected** हो जाती है: वे capabilities जिन्हें आपने declare तो किया पर कभी इस्तेमाल नहीं किया, हटाया जा सकने वाला शोर हैं; और detected लेकिन undeclared capabilities वे हैं जिन्हें समझाना उपयोगी है। harbor अपनी `dsh.capabilities` भी declare करता है, इसलिए इस flow को tool पर ही दोहराया जा सकता है: इस repository में `harbor manifest .` चलाएँ।

यह convention [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)) में लिखा है। एक पंक्ति में: `dsh.capabilities`, `package.json` में एक साधारण list है जो बताती है कि आपके प्लगइन का code वास्तव में क्या करता है। इसे declare करना आसान है और इससे दोहरा लाभ मिलता है — harbor जैसे audit tools आपके कथन को code से मिला सकते हैं, और प्लगइन चलाने वाले लोग देख सकते हैं कि आप कुछ छिपा नहीं रहे। अपनी declaration को किसी भी समय `harbor manifest <dir>` से स्वयं जाँचें।

## सीमाएँ, साफ़ शब्दों में

harbor हर प्लगइन का source पढ़ता है, इसलिए कमरे में सबसे अधिक विशेषाधिकार उसी के पास होते हैं। वह अपनी report में स्वयं भी दिखाई देता है।

Upstream check चालू होने के बाद harbor के पास भी network-egress capability होती है, और उसकी `dsh.capabilities` declaration में यह पहले से सूचीबद्ध है।

## लाइसेंस

MIT
