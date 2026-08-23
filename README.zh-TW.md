<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md"><b>繁體中文</b></a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

harbor 是你已安裝的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 外掛的一面唯讀鏡子：每個外掛**能做什麼**、它們在哪裡互相**衝突**、自上次掃描以來**變了什麼**——每項偵測到的能力都附有可核對的證據。

要不要清理、清理什麼，由你決定。harbor 只陳述事實：不評判、不把關安裝，也不攔截任何東西。

## 它是什麼，又不是什麼

harbor 只做一件事：為已安裝的外掛維護一本持續更新、有證據支撐的事實台帳。這本台帳有三欄——清單本身（每個已安裝的第三方外掛，偵測器能定位時會附上來源位置）、每個外掛「聲明了什麼」與「程式碼實際做了什麼」的核對，以及兩次掃描之間的變化時間軸。

它刻意不做什麼，同樣是設計的一部分。它不會在外掛安裝前審查或把關——准入控制屬於外掛市集工具。它不會深入監控上游相依套件；上游檢查只涵蓋外掛版本，到此為止。它不做一般性的程式碼稽核，也不攔截、封鎖或沙箱化外掛行為。

最後一項不是範圍取捨，而是宿主的客觀事實。DSH 的 Cordis 執行環境沒有能力沙箱：外掛在宿主的主要 Node realm 中執行，擁有宿主本身的權限。harbor 可以讓能力**可見**、將其**偵測**出來，並與聲明**核對**——但無法將它們關閉。要約束外掛行為，需要 DSH 載入器本身提供支援；下文的聲明流程，就是以資料促成這項標準，而不是停留在抽象爭論。

最後，harbor 報告事實，不給評分。它的輸出始終是「偵測到了什麼，以及證據在哪裡」——絕不是風險等級，也不是品質評分。一項發現對你意味著什麼，由你判斷，而不是由 harbor 決定。

> **狀態：`0.1.0-rc.1`，候選版本強化中。** CLI、僅限回環的 hub 路由、DSH 設定面板、跨 profile 漂移，以及選擇性啟用的上游檢查均已可用。運作中的宿主會提供執行期工具、Provider 與路由；沒有運作中宿主時，執行期證據會明確降級為 `available: false`。偵測器仍採用啟發式方法，並持續針對更廣泛的生態系校準，因此請檢視證據，不要把「未偵測到」視為「不存在」的證明。

## 它會查看什麼

```
~/.dsh/profiles/*                → 已安裝的第三方 bundle（npm 與 link: 一視同仁）
  ├─ declared    package.json / cordis.patch.yml —— 外掛對自己的描述
  ├─ runtime     宿主中實際註冊的 tools / routes / providers
  ├─ static      子程序、網路連出、寫入外部設定 —— 附 file:line
  ├─ versions    漂移（本機，永遠檢查）+ 上游（連網，選擇性啟用）
  └─ snapshot    與上次掃描做 diff：新版本、新能力
        └─ 核對：聲明的 dsh.capabilities vs 實際偵測結果
```

能力是一組固定的十三個項目——用戶端注入、realm 風險、realm 副本、全域 hook、LLM 轉接器、子程序、網路連出、Web 路由、工具註冊、MCP 伺服器、外部設定寫入、憑證處理、環境變數讀取。採用固定集合，才能讓不同掃描的報告持續可比較、可做 diff。權威清單請見 [SPEC.md](./SPEC.md) §2；機器可讀的事實來源是 `src/scan/detectors.mjs`。

措辭刻意保持中性：稱為「能力」，而不是「風險」。對某些外掛而言，啟動子程序正是它們存在的目的。報告回答「它能做什麼」，至於「它該不該這麼做」，則留給你判斷。

## 版本

harbor 回答兩個版本問題，並將它們明確分開。

**跨 profile 漂移**完全是本機資訊。同一個外掛在不同 profile 中使用不同版本，是這台機器上的客觀事實，因此每次掃描都會免費計算。`link:` 或 `file:` 安裝不會被當成「最新」基準：工作樹領先已發佈版本是正常情況，不是漂移。

**上游檢查**會離開這台機器，因此永遠不屬於預設掃描。CLI 需要使用 `harbor scan --check-updates`；面板需要明確按下按鈕，按鈕旁的文字也會說明這一點——這是頁面上唯一會離開你機器的動作。每筆結果會是以下五種狀態之一：

- **behind** —— registry 上有較新的版本
- **current** —— 已安裝版本與 registry 相符
- **ahead** —— 已安裝版本比 registry 更新（在維護者的機器上確實可能發生）
- **local** —— `link:` / `file:` 安裝，沒有可供比較的上游，也永遠不會顯示為「已是最新版本」
- **unknown** —— 查詢失敗

registry 會從你自己的 `.npmrc` 讀取（包括 `@scope:registry` 覆寫），絕不硬編碼為 npmjs。結果會在磁碟上快取六小時。

## 安裝

本機開發可從 checkout 安裝：

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` 會將其餘參數轉交給 profile 目錄內的 pnpm，而 `link:` 會把 profile 相依套件符號連結至這份 checkout，因此重新建置的內容會直接生效。若從 registry 安裝，請使用候選版本的 `next` tag：

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

之後請重新啟動 DSH，讓新的 profile 層載入。

面板位於 DSH Web UI 的**設定**頁面，名稱為 **DSH Harbor**——它與 CLI 是同一面鏡子：包含附證據的清單、衝突、版本，以及自上次掃描以來的差異。其中的**檢查更新**按鈕，是該頁面上唯一會離開你機器的動作。面板屬於外掛的 hub 部分，只會掛載於具有 Web 伺服器的 profile。

外掛的執行檔安裝在所選的 profile 中；將它加入 `web` 並不會把 `harbor` 放到 shell 的全域 `PATH`。請透過該 profile 執行：

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

若要從 checkout 或 registry 單次執行，請分別使用以下任一方式：

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## 使用方式

以下範例用 `harbor` 代指上述任一執行方式。

```bash
harbor scan                 # 清單、衝突，以及自上次掃描以來的變化
harbor scan --check-updates # 加上選擇性啟用的 registry 上游檢查（會連網）
harbor manifest ./my-plugin # 為你自己的外掛起草 dsh.capabilities 區塊
```

加上 `--evidence` 可列印現有的 `file:line` 來源證據，`--json` 可取得完整的機器可讀報告，`--no-snapshot` 則可略過寫入 diff 基準。從 manifest、檔案系統或執行期取得的事實可能沒有來源行，系統會據實標示。

掃描器不含相依套件，也不需要安裝 DSH，因此同樣可以在 CI 中執行。

## 給外掛作者

`harbor manifest` 會用讀取其他外掛的相同方式讀取你的外掛，並起草一個 `capabilities` 成員，供你合併進 `package.json` 現有的 `dsh` 物件；它絕不會要求你取代整個物件，導致 `bundle` 或 `client` 設定遺失。完成聲明後，harbor 的檢查就會變成**聲明 vs 偵測**：已聲明卻從未使用的能力，是可以移除的雜訊；已偵測卻未聲明的能力，才值得加以說明。harbor 也聲明了自己的 `dsh.capabilities`，因此你可以直接在這個工具本身重現此流程：在本儲存庫執行 `harbor manifest .`。

這項慣例已記錄於 [SPEC.md](./SPEC.md)（[SPEC.zh.md](./SPEC.zh.md)）。一句話說明：`dsh.capabilities` 是 `package.json` 中的一份普通清單，用來陳述外掛程式碼實際會做什麼。聲明的成本很低，卻有雙重回報——harbor 之類的稽核工具可以核對你的文字與程式碼，執行你外掛的人也能看出你沒有隱瞞任何事情。你隨時可以用 `harbor manifest <dir>` 自行檢查聲明。

## 坦白說明限制

harbor 會讀取每個外掛的原始碼，因此它是整個環境中權限最高的工具。它也會出現在自己的報告裡。

一旦啟用上游檢查，harbor 本身便具備網路連出能力，而它的 `dsh.capabilities` 聲明已經列出這項能力。

## 授權條款

MIT
