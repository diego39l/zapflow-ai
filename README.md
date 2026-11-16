<div align="center">

![ZapFlow AI](docs/brand/zapflow-ai-claro.svg)

# ZapFlow AI

CRM de vendas com inteligência artificial para WhatsApp.

</div>

Projeto de Diego Barros, derivado de [thalena-lima/deskcomm](https://github.com/thalena-lima/deskcomm), edição do [DeskcommCRM de Rafael Melgaço](https://github.com/melgarafael/DeskcommCRM).

## Estado do projeto

Personalização inicial em desenvolvimento. O código foi copiado; **não há instalação de produção validada nem release própria publicada nesta etapa**. Os recursos herdados precisam ser verificados na sua infraestrutura antes do uso com clientes.

- Nome padrão e logo vetorial: **ZapFlow AI**, inclusive no favicon e na barra lateral.
- Marca por instalação e por organização preservada: configurações existentes no banco continuam tendo prioridade.
- Imagens de produção configuradas para o namespace **ghcr.io/diego39l**. Os nomes técnicos `deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler` e `deskcomm-voice-agent` são mantidos para compatibilidade com a esteira.
- Instalação e atualização usam este repositório. **Não execute o instalador até publicar e verificar as quatro imagens de uma release própria.**

## Recursos herdados

Atendimento WhatsApp, funis de vendas, contatos, agentes de IA, base de conhecimento, automações, múltiplas organizações e controles de acesso. A documentação original está em [docs/index.md](docs/index.md); o setup para desenvolvimento está em [docs/SETUP.md](docs/SETUP.md).

## Desenvolvimento

```bash
git clone https://github.com/diego39l/zapflow-ai.git
cd zapflow-ai
corepack pnpm@9.15.9 install --frozen-lockfile
```

Use Node.js 22 ou superior. Preencha o ambiente conforme `docs/SETUP.md`, com serviços de teste próprios; não reutilize credenciais de produção. O schema de instalação é `supabase/baseline.sql`.

## Personalização e distribuição

Consulte [o registro da personalização](docs/ZAPFLOW-AI.md), com limites, validação e próximos passos de distribuição. Para mudar nome, cores ou logo em uma instalação, use `/admin/marca`; para cada organização, `/app/settings/marca`.

## Guias de assistentes

O código herdado inclui guias para os assistentes de programação. Para usar os guias deste clone, rode `bash scripts/instalar-guias.sh --fonte .`. No Codex, a forma é `$deskcomm-instalar`; no Claude Code, `/deskcomm-instalar`. Os nomes técnicos foram mantidos. Os guias não se atualizam sozinhos: refaça a instalação da cópia quando quiser atualizá-la. No Claude Code, o guia global vale mais que o do clone; confira a origem antes de operar uma instalação.

Para remover a cópia instalada pela entrada via pipe, use `bash -s -- --remover`; para remover a partir deste clone, rode `bash scripts/instalar-guias.sh --remover`.

## Licença e créditos

[MIT](LICENSE). Copyright original de Rafael Melgaço e histórico de contribuidores preservados. A adaptação não implica afiliação ou endosso dos autores originais. Glifos do logotipo derivados de DejaVu Sans Bold: [licença](docs/brand/FONT-LICENSE.txt).
