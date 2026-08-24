<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md"><b>Deutsch</b></a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Ein schreibgeschützter Spiegel deiner installierten [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)-Plugins: was jedes einzelne **tun kann**, wo sie **kollidieren** und was sich seit dem letzten Scan **geändert hat** — mit überprüfbaren Belegen für jede erkannte Fähigkeit.

Ob du etwas bereinigen möchtest, entscheidest du. harbor stellt Fakten dar; es urteilt nicht, kontrolliert keine Installationen und fängt nichts ab.

## Was es ist — und was nicht

harbor erfüllt genau eine Aufgabe: Es führt ein fortlaufendes, durch Belege gestütztes Verzeichnis deiner installierten Plugins. Dieses Verzeichnis umfasst drei Spalten — den Bestand selbst (jedes installierte Drittanbieter-Plugin, einschließlich Quellpfaden, sofern der Detektor sie ermitteln kann), den Abgleich dessen, was jedes Plugin deklariert, mit dem tatsächlichen Verhalten seines Codes sowie die zeitliche Abfolge der Änderungen zwischen den Scans.

Was harbor bewusst nicht tut, gehört ebenso zu seinem Konzept. Es prüft oder blockiert Plugins nicht vor der Installation — die Zulassungskontrolle ist Aufgabe der Plugin-Marketplace-Werkzeuge. Es steigt nicht tief in die Überwachung von Upstream-Abhängigkeiten ein; die Upstream-Prüfung umfasst Plugin-Versionen und endet dort. Es führt keine allgemeine Codeprüfung durch und fängt Plugin-Verhalten weder ab noch blockiert oder isoliert es dieses.

Der letzte Punkt ist keine Entscheidung über den Funktionsumfang, sondern eine Eigenschaft des Hosts. Die Cordis-Laufzeit von DSH besitzt keine Capability-Sandbox: Ein Plugin läuft im Haupt-Node-Realm des Hosts mit dessen eigenen Berechtigungen. harbor kann Fähigkeiten **sichtbar machen**, **erkennen** und mit Deklarationen **abgleichen** — aber es kann sie nicht abschalten. Die Eingrenzung von Plugin-Verhalten erfordert Unterstützung im DSH-Loader selbst. Der unten beschriebene Deklarationsablauf schafft die Datengrundlage, um diesen Standard zu entwickeln, statt nur abstrakt darüber zu diskutieren.

Schließlich meldet harbor Fakten, keine Bewertungen. Seine Ausgabe lautet immer „Was wurde erkannt und wo befindet sich der Beleg?“ — niemals Risikostufe oder Qualitätsnote. Was ein Befund für dich bedeutet, entscheidest du und nicht harbor.

> **Status: `0.1.0-rc.2`, Härtung des Release Candidates.** CLI, auf Loopback beschränkte Hub-Routen, DSH-Einstellungsbereich, profilübergreifende Abweichungen und die optionale Upstream-Prüfung stehen zur Verfügung. Ein aktiver Host liefert Laufzeit-Tools, -Provider und -Routen; außerhalb eines solchen Hosts werden Laufzeitbelege ausdrücklich auf `available: false` zurückgestuft. Die Detektoren arbeiten weiterhin heuristisch und werden anhand des breiteren Ökosystems kalibriert. Prüfe daher ihre Belege, anstatt das Ausbleiben eines Befunds als Beweis für das Nichtvorhandensein zu verstehen.

## Was untersucht wird

```
~/.dsh/profiles/*                → installierte Drittanbieter-Bundles (npm und link: gleichermaßen)
  ├─ declared    package.json / cordis.patch.yml — was das Plugin über sich selbst angibt
  ├─ runtime     im Host tatsächlich registrierte tools / routes / providers
  ├─ static      Unterprozesse, Netzwerkzugriffe, Schreibzugriffe auf fremde Config — mit file:line
  ├─ versions    Abweichungen (lokal, immer) + Upstream (vernetzt, optional)
  └─ snapshot    Diff zum vorherigen Scan: neue Versionen, neue Fähigkeiten
        └─ Abgleich: deklarierte dsh.capabilities vs. erkannte Fähigkeiten
```

Die Fähigkeiten bilden eine feste Menge aus dreizehn Einträgen — Client-Injektion, Realm-Risiken, Realm-Kopien, globale Hooks, LLM-Adapter, Unterprozesse, ausgehende Netzwerkzugriffe, Web-Routen, Tool-Registrierung, MCP-Server, Schreibzugriffe auf fremde Konfigurationen, Verarbeitung von Zugangsdaten und Auslesen der Umgebung. Die feste Menge sorgt dafür, dass Berichte zwischen Scans vergleichbar bleiben und Diffs möglich sind. Die maßgebliche Liste steht in [SPEC.md](./SPEC.md) §2; die maschinenlesbare Quelle der Wahrheit ist `src/scan/detectors.mjs`.

Die Wortwahl ist bewusst neutral: **Fähigkeit**, nicht Risiko. Bei manchen Plugins ist das Starten von Unterprozessen ihr eigentlicher Zweck. Der Bericht beantwortet „Was kann es tun?“ und überlässt dir die Frage „Sollte es das tun?“.

## Versionen

harbor beantwortet zwei Versionsfragen und hält sie getrennt.

**Profilübergreifende Abweichungen** sind rein lokal. Wenn dasselbe Plugin in verschiedenen Profilen unterschiedliche Versionen besitzt, ist das eine Tatsache auf diesem Rechner und wird daher bei jedem Scan ohne Zusatzaufwand berechnet. Eine `link:`- oder `file:`-Installation wird nicht als „neueste“ Referenz berücksichtigt: Dass ein Arbeitsbaum seiner veröffentlichten Version voraus ist, ist normal und keine Abweichung.

Die **Upstream-Prüfung** verlässt den Rechner und ist deshalb nie Teil des Standard-Scans. In der CLI ist `harbor scan --check-updates` erforderlich; im Bereich muss eine Schaltfläche ausdrücklich betätigt werden. Der Text daneben weist darauf hin — dies ist die einzige Aktion auf dieser Seite, die deinen Rechner verlässt. Jedes Ergebnis hat einen von fünf Zuständen:

- **behind** — in der Registry ist eine neuere Version vorhanden
- **current** — die installierte Version entspricht der Registry-Version
- **ahead** — die installierte Version ist neuer als die Registry-Version (ein realer Zustand auf dem Rechner eines Maintainers)
- **local** — eine `link:`- / `file:`-Installation ohne vergleichbaren Upstream, die nie als „aktuell“ angezeigt wird
- **unknown** — die Abfrage ist fehlgeschlagen

Die Registry wird aus deiner eigenen `.npmrc` gelesen (einschließlich Überschreibungen über `@scope:registry`) und nie fest auf npmjs eingestellt. Ergebnisse werden sechs Stunden lang auf der Festplatte zwischengespeichert.

## Installation

Für die lokale Entwicklung installierst du es aus einem Checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` leitet alle weiteren Argumente an pnpm im Profilverzeichnis weiter. `link:` verknüpft die Profilabhängigkeit per Symlink mit diesem Checkout, sodass neue Builds dort direkt verfügbar sind. Für eine Registry-Installation verwendest du den Kandidaten-Tag `next`:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Starte DSH anschließend neu, damit die neue Profilebene geladen wird.

Der Bereich erscheint in der DSH-Weboberfläche unter **Settings** als Abschnitt **DSH Harbor** — derselbe Spiegel wie die CLI: Bestand mit Belegen, Konflikte, Versionen und das Diff seit dem letzten Scan. Die Schaltfläche **Check for updates** ist die einzige Aktion auf dieser Seite, die deinen Rechner verlässt. Der Bereich gehört zur Hub-Hälfte des Plugins, die nur in Profilen mit einem Webserver eingebunden wird.

Die ausführbare Datei des Plugins wird im ausgewählten Profil installiert. Wenn du es zu `web` hinzufügst, landet `harbor` nicht im globalen `PATH` deiner Shell. Führe es über dieses Profil aus:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Für einen Checkout oder eine einmalige Ausführung aus der Registry verwendest du stattdessen eine dieser Varianten:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Verwendung

In den folgenden Beispielen steht `harbor` als Kurzform für eine der oben beschriebenen Aufrufvarianten.

```bash
harbor scan                 # Bestand, Konflikte und Änderungen seit dem letzten Scan
harbor scan --check-updates # + optionale Upstream-Prüfung gegen die Registry (vernetzt)
harbor manifest ./my-plugin # entwirft einen dsh.capabilities-Block für dein eigenes Plugin
```

Füge `--evidence` hinzu, um verfügbare `file:line`-Quellbelege auszugeben, `--json` für den vollständigen maschinenlesbaren Bericht und `--no-snapshot`, um das Schreiben der Diff-Basis zu überspringen. Fakten aus Manifest, Dateisystem oder Laufzeit können ohne Quellzeile vorliegen und werden entsprechend gekennzeichnet.

Der Scanner ist abhängigkeitsfrei und benötigt keine DSH-Installation, sodass er auch in CI ausgeführt werden kann.

## Für Plugin-Autoren

`harbor manifest` liest dein Plugin auf dieselbe Weise wie alle anderen und entwirft das Element `capabilities`, das in das bestehende `dsh`-Objekt deiner `package.json` übernommen werden soll. Es fordert dich nie auf, dieses Objekt zu ersetzen und dabei die Konfiguration für `bundle` oder `client` zu verlieren. Nach der Deklaration wird die Prüfung von harbor zum Abgleich **deklariert vs. erkannt**: Fähigkeiten, die du deklarierst, aber nie nutzt, sind entfernbares Rauschen; erkannt, aber nicht deklarierte Fähigkeiten solltest du hingegen erklären. harbor deklariert auch seine eigenen `dsh.capabilities`, sodass sich der Ablauf am Werkzeug selbst nachvollziehen lässt: Führe in diesem Repository `harbor manifest .` aus.

Die Konvention selbst ist in [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)) dokumentiert. Kurz gesagt: `dsh.capabilities` ist eine einfache Liste in `package.json`, die angibt, was der Code deines Plugins tatsächlich tut. Die Deklaration ist unkompliziert und zahlt sich doppelt aus — Audit-Werkzeuge wie harbor können deine Angaben mit deinem Code abgleichen, und die Nutzer deines Plugins sehen, dass du nichts verbirgst. Mit `harbor manifest <dir>` kannst du deine Deklaration jederzeit selbst prüfen.

## Grenzen, klar benannt

harbor liest den Quellcode jedes Plugins und ist damit das am stärksten privilegierte Element im Raum. Es erscheint in seinem eigenen Bericht.

Sobald die Upstream-Prüfung aktiviert wird, verfügt harbor selbst über die Fähigkeit für ausgehende Netzwerkzugriffe; seine `dsh.capabilities`-Deklaration führt sie bereits auf.

## Lizenz

MIT
