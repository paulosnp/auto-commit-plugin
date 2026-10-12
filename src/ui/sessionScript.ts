export const sessionScript = String.raw`
const vscode = acquireVsCodeApi();
const mode = document.querySelector('main').dataset.mode;
const cards = [...document.querySelectorAll('.draft')];
const send = (action, index = 0, message = '', allowStale = false) => vscode.postMessage({ action, index, message, allowStale });
document.getElementById('close').onclick = () => send('close');
const refreshers = new Map();
cards.forEach((card, index) => {
  const textarea = card.querySelector('textarea');
  const feedback = card.querySelector('.feedback');
  const copy = card.querySelector('.copy') || document.getElementById('copy');
  const git = card.querySelector('.use-git');
  let available = git && !git.disabled;
  let previousAction = 'copy';
  const refresh = () => {
    const value = textarea?.value || '';
    const length = value.split(/\r?\n/)[0].trim().length;
    const invalid = textarea && (!value.trim() || length > 72 || value.length > 4000);
    const busy = card.dataset.busy === 'true';
    card.querySelectorAll('button').forEach(button => { button.disabled = busy || ((button === copy || button === git) && invalid) || (button === git && !available); });
    if (textarea) {
      textarea.readOnly = busy;
      const counter = card.querySelector('.subject-count');
      counter.textContent = length + ' / 72';
      counter.classList.toggle('invalid', Boolean(invalid));
      const lines = value.split(/\r?\n/).length;
      card.querySelector('.line-count').textContent = lines + (lines === 1 ? ' linha' : ' linhas');
      card.querySelector('kbd').textContent = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
    }
    card.setAttribute('aria-busy', String(busy));
  };
  refreshers.set(index, refresh);
  const request = (action, allowStale = false) => {
    if (card.dataset.busy === 'true') return;
    if (action === 'copy' || action === 'useGit') previousAction = action;
    card.dataset.busy = 'true';
    feedback.textContent = action === 'regenerate' ? 'Gerando nova mensagem…' : 'Verificando alterações…';
    feedback.classList.remove('error');
    refresh();
    send(action, index, textarea?.value || '', allowStale);
  };
  copy.onclick = () => request('copy');
  if (git) git.onclick = () => request('useGit');
  card.querySelectorAll('.regenerate, .stale-regenerate').forEach(button => { button.onclick = () => request('regenerate'); });
  card.querySelector('.use-previous').onclick = () => request(previousAction, true);
  const edit = card.querySelector('#edit');
  if (edit) edit.onclick = () => request('edit');
  textarea?.addEventListener('input', () => { feedback.textContent = 'Alterações ainda não copiadas ou usadas no Git.'; refresh(); });
  textarea?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); copy.click(); }
  });
  card.addEventListener('sessionResult', event => {
    const data = event.detail;
    card.dataset.busy = 'false';
    if (data.draft && data.outcome === 'updated') {
      available = data.draft.canUseGit;
      if (git) git.title = available ? '' : 'Git nativo indisponível para este repositório.';
      const explanation = card.querySelector('.git-unavailable');
      if (explanation) explanation.hidden = available;
      if (textarea) textarea.value = data.draft.message;
      card.querySelector('.draft-meta').firstChild.textContent = data.draft.scope === 'staged' ? 'Somente staged · ' : 'Todas as alterações · ';
      card.querySelector('.draft-model').textContent = data.draft.provider + ' · ' + data.draft.model;
      card.querySelector('.reuse').textContent = data.draft.reused ? ' · Mensagem reutilizada' : '';
    }
    if (data.draft) card.querySelector('.stale-warning').hidden = !data.draft.stale;
    refresh();
    if (data.outcome === 'stale') {
      card.querySelector('.use-previous').textContent = previousAction === 'useGit' ? 'Usar mensagem anterior no Git' : 'Copiar mensagem anterior';
      card.querySelector('.stale-regenerate').focus();
    }
    feedback.textContent = data.message || ({ copied: 'Mensagem copiada.', applied: 'Mensagem preenchida no Git.', updated: 'Nova mensagem pronta.', stale: 'Revise o aviso antes de continuar.', cancelled: 'Substituição cancelada.' }[data.outcome] || '');
    feedback.classList.toggle('error', data.outcome === 'error');
    refresh();
  });
  refresh();
});
window.addEventListener('message', event => {
  const data = event.data;
  if (data?.action !== 'sessionResult' || !Number.isInteger(data.index)) return;
  cards[data.index]?.dispatchEvent(new CustomEvent('sessionResult', { detail: data }));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); send('close'); }
  if (mode === 'preview' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); document.getElementById('copy').click(); }
});
(document.querySelector('.stale-warning:not([hidden]) .stale-regenerate') || document.querySelector('textarea') || document.getElementById('copy'))?.focus();
`;
