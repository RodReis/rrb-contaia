# syntax=docker/dockerfile:1
#
# Imagem de um serviço Node do monorepo no Compose local (ADR-012): api, workers ou signer.
#   --build-arg PACOTE=@contaia/<nome> --build-arg PASTA=apps/<nome>
#
# Uma imagem só para os três evita três Dockerfiles que derivam. É a árvore do workspace já
# instalada e compilada, só com o subgrafo de dependências do serviço (`<pacote>...`). Segredo
# nenhum entra na imagem: chaves, tokens e pepper são montados como arquivos pelo Compose.
# Imagem de desenvolvimento local; não é artefato de produção (produção é gate posterior ao MVP-4).
FROM node:24-alpine

ARG PACOTE
ARG PASTA

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile --filter "${PACOTE}..." \
  && pnpm --filter "${PACOTE}..." build

# Usuário sem privilégio. O Compose pode trocar o uid para o do dono dos arquivos de segredo.
USER node
WORKDIR /repo/${PASTA}
CMD ["node", "dist/main.js"]
