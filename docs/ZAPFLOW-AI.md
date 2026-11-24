# ZapFlow AI — personalização inicial

## Escopo

Destino: núcleo (identidade padrão) e infraestrutura (origem do código e imagens). A operação comum permanece disponível sem extensões; não há dependência nova de módulo. Esta é uma derivação do produto, por isso o nome e a geometria padrão mudam juntos. Marca já salva no banco não é sobrescrita.

## Marca

`lib/branding.ts` fornece o nome padrão. `lib/branding/desenho.ts` fornece a geometria compartilhada por `MarcaDoProduto` e `app/icon.tsx`: raio e palavra ZapFlow com sufixo AI. Os SVGs em `docs/brand/zapflow-ai-*.svg` são a representação para documentação. As cores do tema original foram conservadas para preservar a régua de contraste; nome, logo e cores continuam configuráveis pelas telas de marca existentes.

A licença MIT original permanece em `LICENSE`; os avisos de DejaVu acompanham os glifos. Cookies, cabeçalhos de webhook, identificadores de integração e nomes de serviços não foram renomeados: são contratos técnicos.

## Instalação e atualização

`install.sh` e `comecar.sh` apontam para `diego39l/zapflow-ai`. O namespace de imagens em `_common.sh`, no compose de produção e no exemplo de ambiente da VPS é `ghcr.io/diego39l`. A esteira herdada publica com `github.repository_owner` e mantém os quatro nomes técnicos de imagem. As etiquetas OCI dos quatro Dockerfiles apontam para este repositório.

O tratamento legado de uma instalação clonada de `thalena-lima/deskcomm` permanece: ele migra **apenas esse origin exato** para o autor original. Um origin `diego39l/zapflow-ai` nunca é reescrito por essa regra. O agente de atualização consulta as releases do origin da instalação; código copiado não cria releases ou imagens automaticamente.

### Antes da primeira instalação

1. Concluir a revisão e os checks do PR.
2. Habilitar a execução de Actions no fork, se o GitHub a exigir, e conferir a construção das quatro imagens para amd64 e arm64.
3. Publicar uma release própria a partir de um commit validado. A checagem da vitrine do upstream já é restrita ao repositório original e não roda neste fork. Os jobs de release usam `RELEASE_APP_ID` e `RELEASE_APP_PRIVATE_KEY`; esses segredos não são herdados por forks. Conferir os requisitos de token do workflow antes do primeiro corte; não criar uma tag presumindo que a publicação já foi validada.
4. Conferir acesso público aos quatro pacotes no GHCR, tags e digests; não conceder permissões extras a contas de terceiros.
5. Validar instalação em ambiente isolado, com banco limpo, login, onboarding, favicon, temas claro/escuro, e-mail e atualização com rollback.

**Não há deploy, release ou conexão de WhatsApp nesta alteração.** Infraestrutura, domínio e chaves serão definidos na etapa de instalação.

## Continuidade da marca

Entrada: padrão do código, semente do ambiente e configuração existente no banco. Saída: layout, login, `MarcaDoProduto`, ícone e `marcaDaSaida` para e-mails. A configuração continua em `/admin/marca` e `/app/settings/marca`, com os logs e motivos de resolução existentes. Não há evento novo: a alteração não é mutação de dados. Sem configuração, o padrão funciona; se a marca configurada falhar, o resolvedor mantém o caminho de fallback existente e expõe o motivo. Correção humana pela tela e revalidação fecham o retorno; não há decisão automática nova. Não há novo fluxo IA↔humano nem peça de arquitetura; o mapa existente `docs/architecture/marca-propria.architecture.json` continua representando as mesmas relações.

## Validação

Os resultados medidos e as limitações são registrados no PR. Testes de configuração não provam pairing com WhatsApp, entrega de mensagens, isolamento em produção ou funcionamento de serviços externos. A validação visual completa exige Supabase e ambiente fresco; ela deve preceder uma release de produção.
