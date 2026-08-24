<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md"><b>Français</b></a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Un miroir en lecture seule des plugins [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) que vous avez installés : ce que chacun **peut faire**, où ils **entrent en conflit** et ce qui a **changé** depuis la dernière analyse — avec des preuves vérifiables pour chaque capacité détectée.

C'est à vous de décider s'il faut nettoyer quoi que ce soit. harbor expose les faits ; il ne juge pas, ne contrôle pas les installations et n'intercepte rien.

## Ce que c'est — et ce que ce n'est pas

harbor ne fait qu'une chose : il tient un registre continu et étayé par des preuves des plugins que vous avez installés. Ce registre comporte trois colonnes — l'inventaire lui-même (chaque plugin tiers installé, avec l'emplacement de ses sources lorsque le détecteur en dispose), le rapprochement entre ce que chaque plugin déclare et ce que son code fait réellement, et la chronologie des changements entre deux analyses.

Ce que harbor ne fait délibérément pas fait tout autant partie de sa conception. Il n'évalue ni ne filtre les plugins avant leur installation — le contrôle d'admission relève des outils de marketplace de plugins. Il ne se plonge pas dans la surveillance des dépendances en amont ; la vérification amont couvre les versions des plugins et s'arrête là. Il n'effectue pas d'audit général du code et n'intercepte, ne bloque ni n'isole le comportement des plugins.

Ce dernier point n'est pas une décision de périmètre, mais un fait lié à l'hôte. L'environnement d'exécution Cordis de DSH ne dispose d'aucun bac à sable de capacités : un plugin s'exécute dans le realm Node principal de l'hôte, avec les mêmes privilèges que celui-ci. harbor peut rendre les capacités **visibles**, les **détecter** et les **rapprocher** des déclarations — mais il ne peut pas les désactiver. Le confinement du comportement des plugins nécessite une prise en charge par le chargeur DSH lui-même, et le flux de déclaration ci-dessous permet d'établir cette norme à partir de données plutôt que de la défendre dans l'abstrait.

Enfin, harbor rapporte des faits, pas des scores. Sa sortie indique toujours « ce qui a été détecté et où se trouvent les preuves » — jamais un niveau de risque ni une note de qualité. C'est à vous, et non à harbor, de juger ce qu'un constat signifie.

> **État : `0.1.0-rc.2`, consolidation de la version candidate.** La CLI, les routes hub en boucle locale, le panneau de réglages DSH, les écarts entre profils et la vérification amont facultative sont disponibles. Un hôte actif fournit les outils, providers et routes d'exécution ; sans hôte actif, les preuves d'exécution passent explicitement à `available: false`. Les détecteurs restent heuristiques et sont en cours d'étalonnage sur l'ensemble de l'écosystème ; examinez donc leurs preuves au lieu de considérer une absence de détection comme une preuve d'absence.

## Ce qu'il examine

```
~/.dsh/profiles/*                → bundles tiers installés (npm et link: sans distinction)
  ├─ declared    package.json / cordis.patch.yml — ce que le plugin déclare à son sujet
  ├─ runtime     tools / routes / providers réellement enregistrés dans l'hôte
  ├─ static      sous-processus, sorties réseau, écritures de config externe — avec file:line
  ├─ versions    écarts (locaux, toujours) + amont (réseau, facultatif)
  └─ snapshot    diff par rapport à l'analyse précédente : nouvelles versions, nouvelles capacités
        └─ rapprochement : dsh.capabilities déclarées vs capacités détectées
```

Les capacités forment un ensemble fixe de treize éléments — injection côté client, risques liés au realm, copies de realm, hooks globaux, adaptateurs LLM, sous-processus, sorties réseau, routes web, enregistrement d'outils, serveurs MCP, écritures dans des configurations externes, gestion des identifiants et lecture de l'environnement. Cet ensemble est fixe afin que les rapports restent comparables et que leurs différences puissent être calculées d'une analyse à l'autre. La liste de référence se trouve dans [SPEC.md](./SPEC.md) §2 ; la source de vérité lisible par machine est `src/scan/detectors.mjs`.

Le vocabulaire est délibérément neutre : **capacité**, et non risque. Le lancement de sous-processus est précisément la raison d'être de certains plugins. Le rapport répond à la question « que peut-il faire ? » et vous laisse décider « devrait-il le faire ? ».

## Versions

harbor répond à deux questions sur les versions et les maintient séparées.

Les **écarts entre profils** sont purement locaux. Le fait qu'un même plugin ait des versions différentes selon les profils est une réalité de cette machine ; ce calcul est donc effectué gratuitement à chaque analyse. Une installation `link:` ou `file:` n'est pas prise comme référence « la plus récente » : il est normal qu'un arbre de travail devance sa version publiée, ce n'est pas un écart.

La **vérification amont** quitte la machine ; elle ne fait donc jamais partie de l'analyse par défaut. La CLI exige `harbor scan --check-updates` ; dans le panneau, il faut appuyer explicitement sur un bouton, et le texte qui l'accompagne le précise — c'est la seule action de cette page qui quitte votre machine. Chaque résultat appartient à l'un des cinq états suivants :

- **behind** — une version plus récente est disponible dans le registre
- **current** — la version installée correspond à celle du registre
- **ahead** — la version installée est plus récente que celle du registre (un cas réel sur la machine d'un mainteneur)
- **local** — une installation `link:` / `file:`, sans version amont à laquelle la comparer et qui n'est jamais présentée comme « à jour »
- **unknown** — la requête a échoué

Le registre est lu depuis votre propre `.npmrc` (y compris les redéfinitions `@scope:registry`) et n'est jamais codé en dur sur npmjs. Les résultats sont mis en cache sur disque pendant six heures.

## Installation

Pour le développement local, installez le paquet depuis un checkout :

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` transmet le reste de ses arguments à pnpm dans le répertoire du profil, et `link:` crée un lien symbolique entre la dépendance du profil et ce checkout, de sorte que les reconstructions y apparaissent directement. Pour une installation depuis le registre, utilisez le tag candidat `next` :

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Redémarrez ensuite DSH afin que la nouvelle couche du profil soit chargée.

Le panneau apparaît dans l'interface web de DSH, sous **Settings**, dans la section **DSH Harbor** — le même miroir que la CLI : inventaire avec preuves, conflits, versions et différences depuis la dernière analyse. Son bouton **Check for updates** est la seule action de cette page qui quitte votre machine. Le panneau appartient à la moitié hub du plugin, qui n'est montée que dans les profils disposant d'un serveur web.

L'exécutable du plugin est installé dans le profil sélectionné ; l'ajouter à `web` ne place pas `harbor` dans le `PATH` global de votre shell. Exécutez-le par l'intermédiaire de ce profil :

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Pour un checkout ou une exécution ponctuelle depuis le registre, utilisez plutôt l'une des commandes suivantes :

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Utilisation

Dans les exemples ci-dessous, `harbor` sert de raccourci pour l'une des formes d'exécution précédentes.

```bash
harbor scan                 # inventaire, conflits et changements depuis la dernière analyse
harbor scan --check-updates # + vérification amont facultative dans le registre (réseau)
harbor manifest ./my-plugin # prépare un bloc dsh.capabilities pour votre propre plugin
```

Ajoutez `--evidence` pour afficher les preuves sources `file:line` disponibles, `--json` pour obtenir le rapport complet lisible par machine et `--no-snapshot` pour éviter d'écrire la base de référence des différences. Les faits issus du manifeste, du système de fichiers ou de l'exécution peuvent ne pas avoir de ligne source et sont étiquetés en conséquence.

L'analyseur est sans dépendance et ne nécessite pas l'installation de DSH ; il fonctionne donc également en CI.

## Pour les auteurs de plugins

`harbor manifest` lit votre plugin de la même manière qu'il lit tous les autres et prépare le membre `capabilities` à fusionner dans l'objet `dsh` existant de votre `package.json` ; il ne vous demande jamais de remplacer cet objet et de perdre la configuration `bundle` ou `client`. Une fois la déclaration effectuée, la vérification de harbor devient un rapprochement entre **déclaré et détecté** : les capacités que vous déclarez mais n'utilisez jamais sont du bruit que vous pouvez supprimer, tandis que celles qui sont détectées mais non déclarées méritent une explication. harbor déclare également ses propres `dsh.capabilities`, ce qui permet de reproduire le processus sur l'outil lui-même : exécutez `harbor manifest .` dans ce dépôt.

La convention elle-même est décrite dans [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). En une phrase : `dsh.capabilities` est une simple liste dans `package.json` qui indique ce que fait réellement le code de votre plugin. La déclarer demande peu d'efforts et apporte un double bénéfice — les outils d'audit comme harbor peuvent rapprocher vos déclarations de votre code, et les personnes qui exécutent votre plugin peuvent voir que vous ne cachez rien. Vous pouvez à tout moment vérifier votre propre déclaration avec `harbor manifest <dir>`.

## Limites, en toute transparence

harbor lit le code source de chaque plugin, ce qui en fait l'élément le plus privilégié de l'environnement. Il apparaît dans son propre rapport.

Dès que la vérification amont est activée, harbor dispose lui-même de la capacité de sortie réseau, et sa déclaration `dsh.capabilities` la mentionne déjà.

## Licence

MIT
