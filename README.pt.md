<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md"><b>Português</b></a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Um espelho somente leitura dos plugins do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) que você instalou: o que cada um **pode fazer**, onde eles **entram em conflito** e o que **mudou** desde a última verificação — com evidências verificáveis para cada capacidade detectada.

Você decide se quer limpar alguma coisa. harbor apresenta fatos; não julga, não controla instalações nem intercepta nada.

## O que é — e o que não é

harbor faz uma única coisa: mantém um registro contínuo e fundamentado em evidências dos plugins que você instalou. O registro tem três colunas — o inventário propriamente dito (todos os plugins de terceiros instalados, com os locais do código-fonte quando o detector consegue encontrá-los), a conciliação entre o que cada plugin declara e o que seu código realmente faz e a linha do tempo do que mudou entre as verificações.

O que harbor deliberadamente não faz também é parte do seu projeto. Ele não avalia nem bloqueia plugins antes da instalação — o controle de admissão pertence às ferramentas de marketplace de plugins. Ele não se aprofunda no monitoramento de dependências upstream; a verificação upstream cobre as versões dos plugins e termina ali. Ele não realiza auditorias gerais de código e não intercepta, bloqueia nem isola o comportamento dos plugins.

O último ponto não é uma decisão de escopo, mas uma característica do host. O runtime Cordis do DSH não tem sandbox de capacidades: um plugin é executado no realm principal do Node do host, com os mesmos privilégios do host. harbor pode tornar as capacidades **visíveis**, **detectá-las** e **conciliá-las** com as declarações — mas não pode desativá-las. Conter o comportamento dos plugins exige suporte no próprio carregador do DSH, e o fluxo de declaração abaixo permite que esse padrão seja construído com dados, em vez de ser apenas discutido de forma abstrata.

Por fim, harbor relata fatos, não pontuações. Sua saída sempre diz “o que foi detectado e onde está a evidência” — nunca um nível de risco ou uma nota de qualidade. O significado de uma descoberta é uma decisão sua, não do harbor.

> **Status: `0.1.0-rc.1`, reforço da versão candidata.** A CLI, as rotas do hub limitadas ao loopback, o painel de configurações do DSH, as divergências entre perfis e a verificação upstream opcional estão disponíveis. Um host ativo fornece ferramentas, providers e rotas de runtime; fora de um host ativo, as evidências de runtime são explicitamente rebaixadas para `available: false`. Os detectores continuam heurísticos e estão sendo calibrados com o ecossistema mais amplo; portanto, examine as evidências em vez de tratar a ausência de detecção como prova de inexistência.

## O que ele examina

```
~/.dsh/profiles/*                → bundles de terceiros instalados (npm e link: da mesma forma)
  ├─ declared    package.json / cordis.patch.yml — o que o plugin declara sobre si mesmo
  ├─ runtime     tools / routes / providers realmente registrados no host
  ├─ static      subprocessos, saída de rede, gravações em config externa — com file:line
  ├─ versions    divergência (local, sempre) + upstream (com rede, opcional)
  └─ snapshot    diff em relação à verificação anterior: novas versões, novas capacidades
        └─ conciliação: dsh.capabilities declaradas vs. capacidades detectadas
```

As capacidades formam um conjunto fixo de treze itens — injeção no cliente, riscos de realm, cópias de realm, hooks globais, adaptadores de LLM, subprocessos, saída de rede, rotas web, registro de ferramentas, servidores MCP, gravações em configurações externas, manipulação de credenciais e leitura do ambiente. O conjunto é fixo para que os relatórios permaneçam comparáveis e possam ser diferenciados entre verificações. A lista oficial está em [SPEC.md](./SPEC.md) §2; a fonte de verdade legível por máquina é `src/scan/detectors.mjs`.

A terminologia é deliberadamente neutra: **capacidade**, não risco. Criar subprocessos é justamente a finalidade de alguns plugins. O relatório responde “o que isto pode fazer” e deixa “deveria fazer isso?” para você.

## Versões

harbor responde a duas perguntas sobre versões e as mantém separadas.

A **divergência entre perfis** é totalmente local. O mesmo plugin estar em versões diferentes entre perfis é um fato desta máquina, portanto isso é calculado gratuitamente a cada verificação. Uma instalação `link:` ou `file:` não é considerada a referência “mais recente”: é normal que uma árvore de trabalho esteja à frente da versão publicada, e isso não é uma divergência.

A **verificação upstream** sai da máquina, por isso nunca faz parte da verificação padrão. A CLI exige `harbor scan --check-updates`; no painel, é necessário pressionar explicitamente um botão, e o texto ao lado do botão informa isso — é a única ação nessa página que sai da sua máquina. Cada resultado tem um de cinco estados:

- **behind** — o registro tem uma versão mais recente
- **current** — a versão instalada corresponde à versão do registro
- **ahead** — a versão instalada é mais recente do que a versão do registro (um estado real na máquina de um mantenedor)
- **local** — uma instalação `link:` / `file:`, que não tem upstream para comparação e nunca é exibida como “atualizada”
- **unknown** — a consulta falhou

O registro é lido do seu próprio `.npmrc` (incluindo substituições `@scope:registry`) e nunca é fixado no npmjs. Os resultados ficam armazenados em cache no disco por seis horas.

## Instalação

Para desenvolvimento local, instale-o a partir de um checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` encaminha os argumentos restantes para o pnpm dentro do diretório do perfil, e `link:` cria um link simbólico da dependência do perfil para este checkout, de modo que as novas compilações aparecem diretamente. Para instalar pelo registro, use a tag candidata `next`:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Depois, reinicie o DSH para que a nova camada do perfil seja carregada.

O painel aparece na interface web do DSH, em **Settings**, como a seção **DSH Harbor** — o mesmo espelho da CLI: inventário com evidências, conflitos, versões e o diff desde a última verificação. O botão **Check for updates** é a única ação nessa página que sai da sua máquina. O painel faz parte da metade hub do plugin, que só é montada em perfis com um servidor web.

O executável do plugin é instalado dentro do perfil selecionado; adicioná-lo a `web` não coloca `harbor` no `PATH` global do seu shell. Execute-o por meio desse perfil:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Para um checkout ou uma execução única a partir do registro, use uma destas opções:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Uso

Os exemplos abaixo usam `harbor` como abreviação de uma das formas de execução acima.

```bash
harbor scan                 # inventário, conflitos e mudanças desde a última verificação
harbor scan --check-updates # + verificação upstream opcional no registro (usa a rede)
harbor manifest ./my-plugin # prepara um bloco dsh.capabilities para o seu próprio plugin
```

Adicione `--evidence` para exibir as evidências de origem `file:line` disponíveis, `--json` para obter o relatório completo legível por máquina e `--no-snapshot` para não gravar a linha de base do diff. Fatos derivados do manifesto, do sistema de arquivos ou do runtime podem não ter uma linha de código-fonte e são identificados dessa forma.

O scanner não tem dependências e não precisa que o DSH esteja instalado, portanto também pode ser executado em CI.

## Para autores de plugins

`harbor manifest` lê seu plugin da mesma forma que lê todos os outros e prepara o membro `capabilities` para ser mesclado ao objeto `dsh` existente no seu `package.json`; ele nunca pede que você substitua esse objeto e perca a configuração de `bundle` ou `client`. Após a declaração, a verificação do harbor se torna uma conciliação entre **declarado e detectado**: capacidades que você declarou mas nunca usa são ruído que pode ser removido, enquanto as capacidades detectadas mas não declaradas são as que merecem uma explicação. harbor também declara suas próprias `dsh.capabilities`, permitindo reproduzir o fluxo na própria ferramenta: execute `harbor manifest .` neste repositório.

A convenção está documentada em [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). Em uma frase: `dsh.capabilities` é uma lista simples em `package.json` que informa o que o código do seu plugin realmente faz. Declarar isso é simples e traz dois benefícios — ferramentas de auditoria como harbor podem conciliar suas palavras com seu código, e as pessoas que executam seu plugin podem ver que você não está escondendo nada. Verifique sua própria declaração a qualquer momento com `harbor manifest <dir>`.

## Limites, declarados com clareza

harbor lê o código-fonte de todos os plugins, o que faz dele o elemento com mais privilégios no ambiente. Ele aparece em seu próprio relatório.

Quando a verificação upstream é ativada, o próprio harbor passa a ter capacidade de saída de rede, e sua declaração `dsh.capabilities` já inclui esse item.

## Licença

MIT
