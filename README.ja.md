<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md"><b>日本語</b></a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

harbor は、インストール済みの [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) プラグインを映す読み取り専用の鏡です。各プラグインが**何をできるか**、どこで互いに**衝突するか**、前回のスキャンから**何が変わったか**を、検出されたすべての capability について確認可能な根拠とともに示します。

何を整理するか、そもそも整理するかどうかは、あなたが決めます。harbor は事実を示すだけで、評価も、インストールの可否判断も、何らかの介入も行いません。

## harbor とは何か、そして何ではないか

harbor が行うことは一つだけです。インストール済みプラグインについて、継続的に更新され、根拠に裏付けられた台帳を維持します。この台帳には三つの柱があります。インベントリそのもの（インストール済みの各サードパーティープラグインと、検出器が特定できた場合のソース位置）、各プラグインの宣言内容とコードが実際に行うことの照合、そしてスキャン間の変更履歴です。

harbor が意図的に行わないことも、同じくらい重要な設計の一部です。インストール前にプラグインを審査したり、導入を制限したりはしません。その役割はプラグインマーケットプレイスのツールに属します。上流の依存関係を深く監視することもなく、上流チェックはプラグイン自体のバージョンだけを対象にします。汎用的なコード監査は行わず、プラグインの動作を横取り、遮断、サンドボックス化することもありません。

最後の点はスコープ上の判断ではなく、ホストに関する事実です。DSH の Cordis ランタイムには capability サンドボックスがありません。プラグインはホストのメイン Node realm 内で、ホスト自身と同じ権限を持って動作します。harbor は capability を**可視化**し、**検出**し、宣言と**照合**できますが、無効化することはできません。プラグインの動作を封じ込めるには DSH ローダー自体の対応が必要です。以下の宣言フローは、その標準を抽象論で主張するのではなく、データに基づいて確立するためのものです。

そして harbor が報告するのは事実であり、スコアではありません。出力は常に「何が検出され、その根拠がどこにあるか」であり、リスクレベルでも品質評価でもありません。検出結果があなたにとって何を意味するかを判断するのは、harbor ではなくあなたです。

> **ステータス：`0.1.0-rc.1`、リリース候補の強化中。** CLI、ループバック限定の hub ルート、DSH 設定パネル、profile 間のドリフト、オプトインの上流チェックが利用できます。稼働中のホストからはランタイムのツール、Provider、ルートが提供されます。稼働中のホストがない場合、ランタイム根拠は明示的に `available: false` へフォールバックします。検出器は引き続きヒューリスティックであり、より広いエコシステムに対して調整中です。そのため、未検出を不存在の証明と見なさず、根拠を確認してください。

## 確認対象

```
~/.dsh/profiles/*                → インストール済みサードパーティー bundle（npm と link: の両方）
  ├─ declared    package.json / cordis.patch.yml — プラグイン自身による宣言
  ├─ runtime     ホストに実際に登録された tools / routes / providers
  ├─ static      サブプロセス、外部通信、外部設定への書き込み — file:line 付き
  ├─ versions    ドリフト（ローカル、常時）+ 上流（ネットワーク、オプトイン）
  └─ snapshot    前回スキャンとの差分：新しいバージョン、新しい capability
        └─ 照合：宣言された dsh.capabilities vs 実際の検出結果
```

capability は、クライアント注入、realm リスク、realm の複製、グローバルフック、LLM アダプター、サブプロセス、外部ネットワーク通信、Web ルート、ツール登録、MCP サーバー、外部設定への書き込み、認証情報の処理、環境変数の読み取り、という固定の十三項目です。固定することで、スキャン間でレポートを比較し、差分を取れる状態を保ちます。正式な一覧は [SPEC.md](./SPEC.md) §2、機械可読な唯一の情報源は `src/scan/detectors.mjs` です。

表現は意図的に中立です。「リスク」ではなく「capability（能力）」と呼びます。プラグインによっては、サブプロセスを起動すること自体が存在目的です。レポートは「何ができるか」に答え、「それを行うべきか」の判断はあなたに委ねます。

## バージョン

harbor は二つのバージョンに関する問いに答え、それらを明確に区別します。

**profile 間のドリフト**は完全にローカルな情報です。同じプラグインが profile ごとに異なるバージョンで存在することは、このマシンに関する事実なので、すべてのスキャンで追加コストなく計算されます。`link:` または `file:` インストールは「最新」の基準には数えません。作業ツリーが公開済みバージョンより先行しているのは通常のことであり、ドリフトではありません。

**上流チェック**はこのマシンの外部へ通信するため、デフォルトのスキャンには決して含まれません。CLI では `harbor scan --check-updates` が必要です。パネルではボタンを明示的に押す必要があり、横の説明にもその旨が記載されています。このページでマシン外部へ通信する操作は、それだけです。各結果は次の五つの状態のいずれかになります。

- **behind** — registry に新しいバージョンがある
- **current** — インストール済みバージョンが registry と一致する
- **ahead** — インストール済みバージョンが registry より新しい（メンテナーのマシンでは実際にあり得る状態）
- **local** — `link:` / `file:` インストールで、比較対象となる上流がなく、「最新」と表示されることもない
- **unknown** — 問い合わせに失敗した

registry は npmjs に固定せず、`@scope:registry` の上書きを含む、あなた自身の `.npmrc` から読み取ります。結果はディスクに六時間キャッシュされます。

## インストール

ローカル開発では checkout からインストールできます。

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` は残りの引数を profile ディレクトリ内の pnpm に渡します。また、`link:` は profile の依存関係をこの checkout へシンボリックリンクするため、再ビルドした内容が直接反映されます。registry からインストールする場合は、候補版の `next` tag を使用します。

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

その後、DSH を再起動して新しい profile レイヤーを読み込ませてください。

パネルは DSH の Web UI の**設定**に **DSH Harbor** セクションとして表示されます。これは CLI と同じ鏡で、根拠付きのインベントリ、衝突、バージョン、前回スキャンからの差分を表示します。パネルの**更新を確認**ボタンは、このページでマシン外部へ通信する唯一の操作です。パネルはプラグインの hub 側に含まれ、Web サーバーを持つ profile でのみマウントされます。

プラグインの実行ファイルは、選択した profile 内にインストールされます。`web` に追加しても、`harbor` がシェルのグローバル `PATH` に入るわけではありません。その profile 経由で実行してください。

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

checkout から、または registry から一度だけ実行する場合は、それぞれ次のいずれかを使用します。

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## 使い方

以下の例では、上記いずれかの実行方法を `harbor` と略記します。

```bash
harbor scan                 # インベントリ、衝突、前回スキャンからの変更
harbor scan --check-updates # + registry に対するオプトインの上流チェック（ネットワーク通信あり）
harbor manifest ./my-plugin # 自分のプラグイン用の dsh.capabilities ブロックを下書き
```

`--evidence` を追加すると利用可能な `file:line` 形式のソース根拠を表示し、`--json` では機械可読な完全版レポートを出力します。`--no-snapshot` を指定すると差分の基準を書き込みません。manifest、ファイルシステム、ランタイムに由来する事実にはソース行がない場合があり、その旨が表示されます。

スキャナーには依存関係がなく、DSH のインストールも不要なため、CI でも実行できます。

## プラグイン作者向け

`harbor manifest` は、ほかのプラグインと同じ方法であなたのプラグインを読み取り、`package.json` にすでにある `dsh` オブジェクトへマージする `capabilities` メンバーを下書きします。オブジェクト全体を置き換えて `bundle` や `client` の設定を失うよう求めることはありません。宣言後、harbor のチェックは**宣言 vs 検出**になります。宣言されていても一度も使われない capability は削減できるノイズであり、検出されても宣言されていない capability こそ説明する価値があります。harbor 自身も `dsh.capabilities` を宣言しているため、このフローをツール自体で再現できます。このリポジトリで `harbor manifest .` を実行してください。

この規約自体は [SPEC.md](./SPEC.md)（[SPEC.zh.md](./SPEC.zh.md)）に記載されています。一言で言えば、`dsh.capabilities` は `package.json` に置く通常のリストで、プラグインのコードが実際に行うことを示します。宣言の手間はわずかですが、二つの利点があります。harbor のような監査ツールが宣言とコードを照合でき、プラグインを実行する人も、何も隠されていないことを確認できます。`harbor manifest <dir>` を使えば、いつでも自分の宣言を検証できます。

## 制限を率直に説明すると

harbor はすべてのプラグインのソースを読み取るため、この環境で最も強い権限を持つ存在です。harbor 自身も自分のレポートに表示されます。

上流チェックを有効にすると、harbor 自身が外部ネットワーク通信の capability を持ちます。そのことは、harbor の `dsh.capabilities` 宣言にすでに記載されています。

## ライセンス

MIT
