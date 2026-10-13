# design-system/

Subconjunto do **CBS Design System** usado por este projeto (site de busca e `/admin`).
Origem: pacote `CBS Design System.zip` (baseado no Manual de Identidade Visual CBS, out/2025).

| Pasta/arquivo | O que é |
| --- | --- |
| `styles.css` | Ponto de entrada; importa `tokens/*.css`. É o único CSS do design system que as páginas carregam. |
| `tokens/` | Cores, tipografia, espaçamento, raios, sombras, movimento e `base.css` (copiados sem alteração, exceto `fonts.css`). |
| `assets/fonts/` | Quicksand (variável, 300–700). |
| `assets/brand/` | Logo (roxo com quadrado laranja e branco), grafismo sorriso e símbolo (favicon). Sem o bloco `<metadata>` C2PA dos originais. |
| `icons.js` | Ícones Lucide (ISC), traço 1.75, usados pelo `/admin`. |

## Ressalvas

- **Carbona (fonte das tag lines) não foi incluída.** Os arquivos recebidos são a versão "Test"
  (trial); as tag lines já vêm vetorizadas nos SVGs. Quicksand cobre todo o resto, como no sistema original.
- Para atualizar o design system, substitua `tokens/` (mantendo o `fonts.css` daqui) e os assets.
- Só os arquivos realmente usados foram copiados. O pacote completo tem os 93 SVGs de marca,
  os componentes React e os UI kits.
