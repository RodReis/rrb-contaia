export const CHAVE_TEMA = 'contaia-theme';

/**
 * Resolve o tema antes da primeira pintura: flash de tema errado é bug
 * (TOKENS.md §2). Sem preferência salva o padrão é claro — o sistema não
 * segue `prefers-color-scheme` sem decisão do PI.
 */
const RESOLVER_TEMA = `(()=>{try{var t=localStorage.getItem('${CHAVE_TEMA}');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}})()`;

export const ScriptDeTema = () => (
  <script dangerouslySetInnerHTML={{ __html: RESOLVER_TEMA }} />
);
