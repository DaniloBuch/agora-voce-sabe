# Testes automáticos

Testes do site com **Playwright** e um **Supabase simulado** (nada vai para o banco de verdade).
Servem para provar que mudanças no código não alteram o que a equipe vê e usa.

## Como rodar

```bash
cd testes
npm install
npx playwright install chromium   # só na primeira vez
npm test
```

## O que tem aqui

| Arquivo | O que testa |
|---|---|
| `unidade.test.js` | funções de `js/comum/` (normalizar, número brasileiro, formatos) direto no Node |
| `busca.test.js` | busca (aspas, -palavra, sinônimos, conectivos, erro de digitação, ref. sem zeros), paginação, links `?q= ?cat= ?area= ?ver= ?ord=`, gaveta, histórico, atalhos, Lista Diária, cotação (+) |
| `paginas.test.js` | cabeçalho, tema, sino, página de novidades, modo sem internet |
| `painel.test.js` | painel /admin: login, lista, filtro, abas, novo produto, edição em massa |
| `nomes.test.js` | checagem dos módulos de `js/`: nome usado sem import e import sobrando (usa o TypeScript só para ler o JS) |
| `visual.test.js` | telas em 1366×768 e no celular (claro e escuro), comparadas pixel a pixel |
| `supabase-simulado.js` | banco de mentira em memória (71 produtos, categorias, áreas, sinônimos, novidades) |
| `referencias/` | o resultado "aprovado" de cada teste (JSON) e as telas (PNG) |

## Quando uma mudança é de propósito

Se você mudou o visual ou o comportamento **de propósito**, os testes vão acusar a diferença.
Confira (as telas novas ficam em `referencias/telas/*.ATUAL.png`) e, se estiver certo, aceite:

```bash
npm run atualizar
```
