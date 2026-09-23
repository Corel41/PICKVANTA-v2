(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Toast
  const toastEl = $('#toast');
  let toastTimer = null;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  // Mobile nav
  const hamburger = $('#hamburger');
  const mobilePanel = $('#mobilePanel');
  if (hamburger && mobilePanel) {
    hamburger.addEventListener('click', () => {
      const expanded = hamburger.getAttribute('aria-expanded') === 'true';
      hamburger.setAttribute('aria-expanded', String(!expanded));
      mobilePanel.classList.toggle('open', !expanded);
      mobilePanel.hidden = expanded;
      document.body.style.overflow = !expanded ? 'hidden' : '';
    });
    // close on link click
    $$('a', mobilePanel).forEach(a => {
      a.addEventListener('click', () => {
        if (a.dataset.toast) return; // handled separately
        hamburger.setAttribute('aria-expanded', 'false');
        mobilePanel.classList.remove('open');
        mobilePanel.hidden = true;
        document.body.style.overflow = '';
      });
    });
  }

  // Search logic
  const searchForm = $('#searchForm');
  const searchInput = $('#searchInput');
  const suggestions = $('#suggestions');

  const EXAMPLES = [
    { label: 'Smartphones', meta: 'Technology', kbd: '⌘K' },
    { label: 'Laptops', meta: 'Technology', kbd: '' },
    { label: 'Apartments', meta: 'Home', kbd: '' },
    { label: 'Travel deals', meta: 'Travel', kbd: '' },
    { label: 'Internet providers', meta: 'Services', kbd: '' },
    { label: 'Furniture', meta: 'Home', kbd: '' },
    { label: 'Headphones', meta: 'Technology', kbd: '' },
    { label: 'Electric cars', meta: 'Automotive', kbd: '' },
  ];

  function renderSuggestions(filter = '') {
    if (!suggestions) return;
    const q = filter.trim().toLowerCase();
    const list = q
      ? EXAMPLES.filter(e => e.label.toLowerCase().includes(q)).slice(0, 6)
      : EXAMPLES.slice(0, 6);

    if (list.length === 0) {
      suggestions.classList.remove('show');
      suggestions.innerHTML = '';
      return;
    }

    suggestions.innerHTML = list.map((item, idx) => `
      <div class="suggestion" role="option" data-value="${item.label}" id="sugg-${idx}" tabindex="-1">
        <span><strong>${item.label}</strong> <small>· ${item.meta}</small></span>
        <small>${item.kbd ? `<kbd>${item.kbd}</kbd>` : 'Demo'}</small>
      </div>
    `).join('');
    suggestions.classList.add('show');

    // click handlers
    $$('.suggestion', suggestions).forEach(el => {
      el.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = el.dataset.value;
          suggestions.classList.remove('show');
          searchInput.focus();
        }
      });
      el.addEventListener('mouseenter', () => {
        $$('.suggestion', suggestions).forEach(s => s.setAttribute('aria-selected', 'false'));
        el.setAttribute('aria-selected', 'true');
      });
    });
  }

  if (searchInput && suggestions) {
    searchInput.addEventListener('focus', () => renderSuggestions(searchInput.value));
    searchInput.addEventListener('input', () => renderSuggestions(searchInput.value));

    // keyboard navigation for suggestions
    searchInput.addEventListener('keydown', (e) => {
      const items = $$('.suggestion', suggestions);
      if (!items.length) return;
      const active = $('.suggestion[aria-selected="true"]', suggestions);
      let idx = active ? items.indexOf(active) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1) % items.length;
        items.forEach(i => i.setAttribute('aria-selected', 'false'));
        items[idx].setAttribute('aria-selected', 'true');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = idx <= 0 ? items.length - 1 : idx - 1;
        items.forEach(i => i.setAttribute('aria-selected', 'false'));
        items[idx].setAttribute('aria-selected', 'true');
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        searchInput.value = active.dataset.value;
        suggestions.classList.remove('show');
      } else if (e.key === 'Escape') {
        suggestions.classList.remove('show');
      }
    });
  }

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!suggestions || !searchInput) return;
    if (!e.target.closest('#searchWrap')) {
      suggestions.classList.remove('show');
    }
    // close mobile if clicking outside
    if (mobilePanel && hamburger && !e.target.closest('#mobilePanel') && !e.target.closest('#hamburger')) {
      if (mobilePanel.classList.contains('open')) {
        hamburger.setAttribute('aria-expanded', 'false');
        mobilePanel.classList.remove('open');
        mobilePanel.hidden = true;
        document.body.style.overflow = '';
      }
    }
  });

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = searchInput ? searchInput.value.trim() : '';
      if (!val) {
        searchInput && searchInput.focus();
        showToast('Type something to search — e.g. “Smartphones”');
        return;
      }
      showToast(`Search functionality will be connected in the next development stage — you searched for “${val}”`);
      if (suggestions) suggestions.classList.remove('show');
    });
  }

  // Chips
  $$('[data-fill]').forEach(chip => {
    chip.addEventListener('click', () => {
      const v = chip.getAttribute('data-fill');
      if (searchInput) {
        searchInput.value = v;
        searchInput.focus();
        renderSuggestions(v);
      }
    });
  });

  // Generic toast for not-yet links
  const notYetMessage = (name) => `${name} will be available in a later stage — foundation is ready for expansion.`;

  // Header nav links, footer, category cards, deal CTAs
  const toastSelectors = [
    '[data-toast]',
  ];

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toast]');
    if (!t) return;
    e.preventDefault();
    const label = t.getAttribute('data-toast') || t.textContent.trim() || 'This feature';
    // Special handling for search icon in header
    if (t.id === 'headerSearchBtn') {
      const heroSearch = $('#searchInput');
      if (heroSearch) {
        heroSearch.focus();
        heroSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('Use the main search above — it’s the core of PickVanta');
      }
      return;
    }
    if (label.toLowerCase().includes('sign in')) {
      showToast('Authentication will be added in a later stage. No login required yet.');
      return;
    }
    showToast(notYetMessage(label));
  });

  // Keyboard: Escape closes panels
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (suggestions) suggestions.classList.remove('show');
      if (mobilePanel && mobilePanel.classList.contains('open')) {
        hamburger.setAttribute('aria-expanded', 'false');
        mobilePanel.classList.remove('open');
        mobilePanel.hidden = true;
        document.body.style.overflow = '';
        hamburger.focus();
      }
    }
  });

  // No console errors check helper (dev only)
  window.PickVanta = {
    showToast,
    version: 'foundation-1.0.0'
  };

  console.log('%cPickVanta foundation loaded — ready for next stage', 'color:#4F46E5;font-weight:700');
})();
