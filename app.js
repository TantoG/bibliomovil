(() => {
  'use strict';

  const DEFAULT_DB_PATH = './Base/tgl1.db';
  const PAGE_SIZE = 60;

  const state = {
    books: [],
    boxes: [],
    genres: [],
    authors: [],
    metadata: {},
    dbSourceName: 'Base/tgl1.db',
    tab: 'libros', // 'libros' | 'cajas' | 'explorar'
    exploreMode: 'generos', // 'generos' | 'autores'
    query: '',
    boxFilter: '',
    genreFilter: '',
    sizeFilter: '',
    sortBy: 'caja', // 'caja' | 'titulo' | 'autor'
    boxSort: 'num', // 'num' | 'count'
    boxSizeFilter: '',
    selectedWheelBox: null,
    visibleLimit: PAGE_SIZE,
    filteredBooks: [],
  };

  const els = {
    statsPillText: document.getElementById('stats-pill-text'),
    infoBtn: document.getElementById('info-btn'),
    searchInput: document.getElementById('search-input'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    tabBtns: Array.from(document.querySelectorAll('.tab-btn')),
    toolbar: document.getElementById('toolbar'),
    statusBar: document.getElementById('status-bar'),
    quickJump: document.getElementById('quick-jump'),
    results: document.getElementById('results'),
    loadMoreWrap: document.getElementById('load-more-wrap'),
    loadMoreBtn: document.getElementById('load-more-btn'),
    bookModal: document.getElementById('book-modal'),
    bookModalBody: document.getElementById('book-modal-body'),
    closeBookModal: document.getElementById('close-book-modal'),
    infoModal: document.getElementById('info-modal'),
    infoModalBody: document.getElementById('info-modal-body'),
    closeInfoModal: document.getElementById('close-info-modal'),
    dbFileInput: document.getElementById('db-file-input'),
  };

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('es-AR');
  }

  function cleanValue(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  async function init() {
    bindEvents();
    registerServiceWorker();
    await loadDatabaseFromUrl(DEFAULT_DB_PATH);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Ignore SW registration failure in unsupported contexts
      });
    }
  }

  function bindEvents() {
    let searchTimer = null;
    els.searchInput.addEventListener('input', (e) => {
      state.query = e.target.value;
      els.clearSearchBtn.classList.toggle('hidden', !state.query);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.visibleLimit = PAGE_SIZE;
        renderActiveView();
      }, 90);
    });

    els.clearSearchBtn.addEventListener('click', () => {
      state.query = '';
      els.searchInput.value = '';
      els.clearSearchBtn.classList.add('hidden');
      state.visibleLimit = PAGE_SIZE;
      renderActiveView();
      els.searchInput.focus();
    });

    els.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        setTab(btn.dataset.tab);
      });
    });

    els.loadMoreBtn.addEventListener('click', () => {
      state.visibleLimit += PAGE_SIZE;
      renderResultsList();
    });

    els.infoBtn.addEventListener('click', openInfoModal);
    els.closeInfoModal.addEventListener('click', () => closeModal(els.infoModal));
    els.closeBookModal.addEventListener('click', () => closeModal(els.bookModal));

    [els.bookModal, els.infoModal].forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal(backdrop);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal(els.bookModal);
        closeModal(els.infoModal);
      }
    });

    els.dbFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        await parseSqliteBuffer(new Uint8Array(buffer), file.name);
        closeModal(els.infoModal);
      } catch (err) {
        alert('No se pudo leer el archivo SQLite: ' + (err?.message || err));
      } finally {
        els.dbFileInput.value = '';
      }
    });
  }

  async function loadDatabaseFromUrl(url) {
    showLoading('Abriendo base de datos…');
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al descargar ${url}`);
      }
      const buffer = await response.arrayBuffer();
      await parseSqliteBuffer(new Uint8Array(buffer), 'Base/tgl1.db');
    } catch (err) {
      showLoadError(err);
    }
  }

  async function parseSqliteBuffer(uint8Array, sourceName) {
    if (typeof window.initSqlJs !== 'function') {
      throw new Error('sql.js no está disponible.');
    }

    const SQL = await window.initSqlJs({
      locateFile: (file) => `./vendor/sqljs/${file}`,
    });

    const db = new SQL.Database(uint8Array);
    try {
      const metadata = {};
      try {
        const metaRes = db.exec('SELECT clave, valor FROM metadatos');
        if (metaRes[0]) {
          for (const [k, v] of metaRes[0].values) {
            metadata[String(k)] = String(v ?? '');
          }
        }
      } catch {
        // metadatos table is optional
      }

      const res = db.exec(`
        SELECT id, caja, indice, titulo, autor, editorial, precio, genero, isbn, archivo, tamano_caja, fecha_exportacion
        FROM libros
        ORDER BY caja ASC, COALESCE(indice, 999999) ASC, id ASC
      `);

      const rows = res[0]?.values || [];
      const books = rows.map((r) => {
        const caja = Number(r[1]) || 0;
        const indice = r[2] !== null && r[2] !== undefined ? Number(r[2]) : null;
        const titulo = cleanValue(r[3]) || '(Sin título)';
        const autor = cleanValue(r[4]);
        const editorial = cleanValue(r[5]);
        const precio = cleanValue(r[6]);
        const genero = cleanValue(r[7]);
        const isbn = cleanValue(r[8]);
        const archivo = cleanValue(r[9]);
        const tamano = cleanValue(r[10]);
        const fechaExport = cleanValue(r[11]);

        const searchBlob = normalizeText(
          `${titulo} ${autor} ${editorial} ${genero} ${isbn} caja ${caja}`
        );

        return {
          id: Number(r[0]),
          caja,
          indice,
          titulo,
          autor,
          editorial,
          precio,
          genero,
          isbn,
          archivo,
          tamano,
          fechaExport,
          normTitulo: normalizeText(titulo),
          normAutor: normalizeText(autor),
          normGenero: normalizeText(genero),
          searchBlob,
        };
      });

      buildAggregates(books);
      state.books = books;
      state.metadata = metadata;
      state.dbSourceName = sourceName;
      state.visibleLimit = PAGE_SIZE;

      updateHeaderStats();
      renderActiveView();
    } finally {
      db.close();
    }
  }

  function buildAggregates(books) {
    const boxMap = new Map();
    const genreMap = new Map();
    const authorMap = new Map();

    for (const b of books) {
      if (!boxMap.has(b.caja)) {
        boxMap.set(b.caja, {
          caja: b.caja,
          tamano: b.tamano,
          count: 0,
          genres: new Map(),
        });
      }
      const box = boxMap.get(b.caja);
      box.count += 1;
      if (!box.tamano && b.tamano) box.tamano = b.tamano;
      if (b.genero) {
        box.genres.set(b.genero, (box.genres.get(b.genero) || 0) + 1);
      }

      if (b.genero) {
        genreMap.set(b.genero, (genreMap.get(b.genero) || 0) + 1);
      }
      if (b.autor) {
        authorMap.set(b.autor, (authorMap.get(b.autor) || 0) + 1);
      }
    }

    state.boxes = Array.from(boxMap.values())
      .map((box) => {
        const topGenres = Array.from(box.genres.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([g]) => g);
        return {
          caja: box.caja,
          tamano: box.tamano,
          count: box.count,
          topGenres,
          searchBlob: normalizeText(`caja ${box.caja} ${box.tamano} ${topGenres.join(' ')}`),
        };
      })
      .sort((a, b) => a.caja - b.caja);

    state.genres = Array.from(genreMap.entries())
      .map(([name, count]) => ({ name, count, norm: normalizeText(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));

    state.authors = Array.from(authorMap.entries())
      .map(([name, count]) => ({ name, count, norm: normalizeText(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  }

  function updateHeaderStats() {
    els.statsPillText.textContent = `${formatNumber(state.books.length)} libros · ${formatNumber(state.boxes.length)} cajas`;
  }

  function setTab(tab) {
    state.tab = tab;
    state.visibleLimit = PAGE_SIZE;
    els.tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    renderActiveView();
  }

  function renderActiveView() {
    if (!state.books.length && els.results.querySelector('.loading-state')) {
      return;
    }
    renderToolbar();
    if (state.tab === 'libros') {
      renderBooksView();
    } else if (state.tab === 'cajas') {
      renderBoxesView();
    } else {
      renderExploreView();
    }
  }

  function renderToolbar() {
    if (state.tab === 'libros') {
      const boxOptions = state.boxes
        .map((b) => `<option value="${b.caja}" ${String(state.boxFilter) === String(b.caja) ? 'selected' : ''}>Caja ${b.caja} (${b.count})</option>`)
        .join('');

      const genreOptions = state.genres
        .slice(0, 120)
        .map((g) => `<option value="${escapeHtml(g.name)}" ${state.genreFilter === g.name ? 'selected' : ''}>${escapeHtml(g.name)} (${g.count})</option>`)
        .join('');

      const hasFilters = Boolean(state.boxFilter || state.genreFilter || state.sizeFilter || state.query);

      els.toolbar.innerHTML = `
        ${state.boxFilter ? '<button id="back-to-boxes-btn" class="chip-btn active" type="button">← Cajas</button>' : ''}
        <select id="filter-box" class="filter-select ${state.boxFilter ? 'active' : ''}" aria-label="Filtrar por caja">
          <option value="">Todas las cajas</option>
          ${boxOptions}
        </select>
        <select id="filter-genre" class="filter-select ${state.genreFilter ? 'active' : ''}" aria-label="Filtrar por género">
          <option value="">Todos los géneros</option>
          ${genreOptions}
        </select>
        <select id="filter-size" class="filter-select ${state.sizeFilter ? 'active' : ''}" aria-label="Filtrar por tamaño de caja">
          <option value="">Tamaño: Todos</option>
          <option value="S" ${state.sizeFilter === 'S' ? 'selected' : ''}>Caja S</option>
          <option value="M" ${state.sizeFilter === 'M' ? 'selected' : ''}>Caja M</option>
          <option value="L" ${state.sizeFilter === 'L' ? 'selected' : ''}>Caja L</option>
          <option value="XL" ${state.sizeFilter === 'XL' ? 'selected' : ''}>Caja XL</option>
        </select>
        <select id="sort-books" class="filter-select" aria-label="Ordenar libros">
          <option value="caja" ${state.sortBy === 'caja' ? 'selected' : ''}>Orden: Caja ↑</option>
          <option value="titulo" ${state.sortBy === 'titulo' ? 'selected' : ''}>Orden: Título A-Z</option>
          <option value="autor" ${state.sortBy === 'autor' ? 'selected' : ''}>Orden: Autor A-Z</option>
        </select>
        ${hasFilters ? '<button id="reset-filters-btn" class="chip-btn reset" type="button">Limpiar</button>' : ''}
      `;

      document.getElementById('filter-box').addEventListener('change', (e) => {
        state.boxFilter = e.target.value;
        state.visibleLimit = PAGE_SIZE;
        renderActiveView();
      });
      document.getElementById('filter-genre').addEventListener('change', (e) => {
        state.genreFilter = e.target.value;
        state.visibleLimit = PAGE_SIZE;
        renderActiveView();
      });
      document.getElementById('filter-size').addEventListener('change', (e) => {
        state.sizeFilter = e.target.value;
        state.visibleLimit = PAGE_SIZE;
        renderActiveView();
      });
      document.getElementById('sort-books').addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        state.visibleLimit = PAGE_SIZE;
        renderBooksView();
      });
      document.getElementById('back-to-boxes-btn')?.addEventListener('click', () => {
        if (state.boxFilter) state.selectedWheelBox = Number(state.boxFilter);
        setTab('cajas');
      });
      document.getElementById('reset-filters-btn')?.addEventListener('click', resetAllFilters);
      return;
    }

    if (state.tab === 'cajas') {
      els.toolbar.innerHTML = `
        <button class="chip-btn ${state.boxSort === 'num' ? 'active' : ''}" data-box-sort="num" type="button">Número 1–${state.boxes.length}</button>
        <button class="chip-btn ${state.boxSort === 'count' ? 'active' : ''}" data-box-sort="count" type="button">Más libros</button>
        <select id="box-size-filter" class="filter-select ${state.boxSizeFilter ? 'active' : ''}" aria-label="Filtrar cajas por tamaño">
          <option value="">Tamaño: Todos</option>
          <option value="S" ${state.boxSizeFilter === 'S' ? 'selected' : ''}>S</option>
          <option value="M" ${state.boxSizeFilter === 'M' ? 'selected' : ''}>M</option>
          <option value="L" ${state.boxSizeFilter === 'L' ? 'selected' : ''}>L</option>
          <option value="XL" ${state.boxSizeFilter === 'XL' ? 'selected' : ''}>XL</option>
        </select>
      `;

      els.toolbar.querySelectorAll('[data-box-sort]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.boxSort = btn.dataset.boxSort;
          renderActiveView();
        });
      });
      document.getElementById('box-size-filter').addEventListener('change', (e) => {
        state.boxSizeFilter = e.target.value;
        renderBoxesView();
      });
      return;
    }

    // Explorar tab
    els.toolbar.innerHTML = `
      <button class="chip-btn ${state.exploreMode === 'generos' ? 'active' : ''}" data-explore="generos" type="button">Géneros (${formatNumber(state.genres.length)})</button>
      <button class="chip-btn ${state.exploreMode === 'autores' ? 'active' : ''}" data-explore="autores" type="button">Autores (${formatNumber(state.authors.length)})</button>
    `;
    els.toolbar.querySelectorAll('[data-explore]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.exploreMode = btn.dataset.explore;
        state.visibleLimit = PAGE_SIZE;
        renderActiveView();
      });
    });
  }

  function resetAllFilters() {
    state.query = '';
    state.boxFilter = '';
    state.genreFilter = '';
    state.sizeFilter = '';
    els.searchInput.value = '';
    els.clearSearchBtn.classList.add('hidden');
    state.visibleLimit = PAGE_SIZE;
    renderActiveView();
  }

  function renderBooksView() {
    const tokens = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const boxNum = state.boxFilter ? Number(state.boxFilter) : null;

    const matched = state.books.filter((b) => {
      if (boxNum !== null && b.caja !== boxNum) return false;
      if (state.genreFilter && b.genero !== state.genreFilter) return false;
      if (state.sizeFilter && b.tamano !== state.sizeFilter) return false;
      for (const t of tokens) {
        if (!b.searchBlob.includes(t)) return false;
      }
      return true;
    });

    if (state.sortBy === 'titulo') {
      matched.sort((a, b) => a.normTitulo.localeCompare(b.normTitulo, 'es') || a.caja - b.caja);
    } else if (state.sortBy === 'autor') {
      matched.sort((a, b) => (a.normAutor || 'zzz').localeCompare(b.normAutor || 'zzz', 'es') || a.normTitulo.localeCompare(b.normTitulo, 'es'));
    } else {
      matched.sort((a, b) => a.caja - b.caja || (a.indice ?? 999999) - (b.indice ?? 999999) || a.id - b.id);
    }

    state.filteredBooks = matched;

    // Quick jump chip when query looks like a box number
    const boxMatch = state.query.trim().match(/^(?:caja\s*)?(\d{1,4})$/i);
    const matchedBox = boxMatch ? state.boxes.find((bx) => bx.caja === Number(boxMatch[1])) : null;
    if (matchedBox && !state.boxFilter) {
      els.quickJump.classList.remove('hidden');
      els.quickJump.innerHTML = `
        <button id="quick-jump-box-btn" class="quick-jump-btn" type="button">
          <span>Abrir Caja ${matchedBox.caja} (${matchedBox.count} libros${matchedBox.tamano ? ' · ' + escapeHtml(matchedBox.tamano) : ''})</span>
          <span>Ver →</span>
        </button>
      `;
      document.getElementById('quick-jump-box-btn').addEventListener('click', () => {
        openBoxBooks(matchedBox.caja);
      });
    } else {
      els.quickJump.classList.add('hidden');
      els.quickJump.innerHTML = '';
    }

    renderResultsList();
  }

  function renderResultsList() {
    const total = state.filteredBooks.length;
    const shown = Math.min(state.visibleLimit, total);
    const slice = state.filteredBooks.slice(0, shown);

    els.statusBar.innerHTML = `
      <span>${total === 0 ? 'Sin resultados' : `Mostrando ${formatNumber(shown)} de ${formatNumber(total)} libros`}</span>
      ${state.boxFilter ? `<span>Caja ${escapeHtml(state.boxFilter)}</span>` : ''}
    `;

    if (total === 0) {
      els.loadMoreWrap.classList.add('hidden');
      els.results.className = 'results';
      els.results.innerHTML = `
        <div class="empty-state">
          <h3>No se encontraron libros</h3>
          <p>Probá con otro término o limpiá los filtros activos.</p>
          <button id="empty-reset-btn" class="secondary-btn" type="button">Limpiar búsqueda y filtros</button>
        </div>
      `;
      document.getElementById('empty-reset-btn').addEventListener('click', resetAllFilters);
      return;
    }

    els.results.className = 'results';
    els.results.innerHTML = slice.map((b) => {
      const idxText = b.indice !== null ? `#${b.indice}` : '';
      const subParts = [idxText, b.tamano].filter(Boolean).join(' · ');
      return `
        <button class="book-card" type="button" data-book-id="${b.id}">
          <div class="book-main">
            <h2 class="book-title">${escapeHtml(b.titulo)}</h2>
            <p class="book-author">${escapeHtml(b.autor || 'Autor no registrado')}</p>
            <div class="book-meta">
              ${b.genero ? `<span class="tag">${escapeHtml(b.genero)}</span>` : ''}
              ${b.editorial ? `<span class="tag">${escapeHtml(b.editorial)}</span>` : ''}
            </div>
          </div>
          <div class="box-badge">
            <span class="box-badge-num">Caja ${b.caja}</span>
            ${subParts ? `<span class="box-badge-sub">${escapeHtml(subParts)}</span>` : ''}
          </div>
        </button>
      `;
    }).join('');

    els.results.querySelectorAll('.book-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = Number(card.dataset.bookId);
        const book = state.books.find((item) => item.id === id);
        if (book) openBookModal(book);
      });
    });

    const hasMore = shown < total;
    els.loadMoreWrap.classList.toggle('hidden', !hasMore);
    if (hasMore) {
      els.loadMoreBtn.textContent = `Mostrar más (${formatNumber(total - shown)} restantes)`;
    }
  }

  function renderBoxesView() {
    els.quickJump.classList.add('hidden');
    els.loadMoreWrap.classList.add('hidden');

    const tokens = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const filtered = state.boxes.filter((bx) => {
      if (state.boxSizeFilter && bx.tamano !== state.boxSizeFilter) return false;
      for (const t of tokens) {
        if (!bx.searchBlob.includes(t)) return false;
      }
      return true;
    });

    if (state.boxSort === 'count') {
      filtered.sort((a, b) => b.count - a.count || a.caja - b.caja);
    } else {
      filtered.sort((a, b) => a.caja - b.caja);
    }

    els.statusBar.innerHTML = `<span>${formatNumber(filtered.length)} cajas encontradas</span><span>Deslizá la rueda y tocá VER</span>`;

    if (filtered.length === 0) {
      els.results.className = 'results';
      els.results.innerHTML = `
        <div class="empty-state">
          <h3>No hay cajas que coincidan</h3>
          <p>Ajustá la búsqueda o el filtro de tamaño.</p>
        </div>
      `;
      return;
    }

    const ITEM_HEIGHT = 44;
    let selectedIdx = filtered.findIndex((bx) => bx.caja === state.selectedWheelBox);
    if (selectedIdx < 0) selectedIdx = 0;
    state.selectedWheelBox = filtered[selectedIdx].caja;

    const wheelItemsHtml = filtered.map((bx, idx) => `
      <button class="wheel-item" type="button" data-wheel-idx="${idx}" data-caja="${bx.caja}">
        <span class="wheel-item-num">Caja ${bx.caja}</span>
        <span class="wheel-item-sub">${bx.count} ${bx.count === 1 ? 'libro' : 'libros'}${bx.tamano ? ' · ' + escapeHtml(bx.tamano) : ''}</span>
      </button>
    `).join('');

    const gridCardsHtml = filtered.map((bx) => `
      <button class="box-card" type="button" data-caja="${bx.caja}">
        <div class="box-card-top">
          <span class="box-card-num">Caja ${bx.caja}</span>
          ${bx.tamano ? `<span class="size-pill">${escapeHtml(bx.tamano)}</span>` : ''}
        </div>
        <div class="box-card-count">${formatNumber(bx.count)} ${bx.count === 1 ? 'libro' : 'libros'}</div>
        <div class="box-card-genres">${escapeHtml(bx.topGenres.join(' · ') || 'Sin género')}</div>
      </button>
    `).join('');

    els.results.className = 'results';
    els.results.innerHTML = `
      <section class="box-wheel-card" aria-label="Selector rápido de caja">
        <div class="wheel-header">
          <h2 class="wheel-title">Ir rápido a una caja</h2>
          <span id="wheel-meta-pill" class="wheel-meta-pill"></span>
        </div>

        <div class="wheel-picker">
          <div class="wheel-highlight" aria-hidden="true"></div>
          <div class="wheel-mask wheel-mask-top" aria-hidden="true"></div>
          <div class="wheel-mask wheel-mask-bottom" aria-hidden="true"></div>
          <div id="box-wheel-viewport" class="wheel-viewport" role="listbox" aria-label="Número de caja">
            <div class="wheel-spacer" aria-hidden="true"></div>
            ${wheelItemsHtml}
            <div class="wheel-spacer" aria-hidden="true"></div>
          </div>
        </div>

        <p id="wheel-preview" class="wheel-preview"></p>

        <div class="wheel-actions">
          <button id="wheel-prev-btn" class="wheel-step-btn" type="button" aria-label="Caja anterior">−</button>
          <button id="wheel-ver-btn" class="primary-btn wheel-ver-btn" type="button">VER</button>
          <button id="wheel-next-btn" class="wheel-step-btn" type="button" aria-label="Caja siguiente">+</button>
        </div>
      </section>

      <div class="boxes-section-label">Todas las cajas (${formatNumber(filtered.length)})</div>
      <div class="boxes-grid">
        ${gridCardsHtml}
      </div>
    `;

    const viewport = document.getElementById('box-wheel-viewport');
    const wheelItems = Array.from(viewport.querySelectorAll('.wheel-item'));
    const metaPill = document.getElementById('wheel-meta-pill');
    const previewEl = document.getElementById('wheel-preview');
    const verBtn = document.getElementById('wheel-ver-btn');
    const prevBtn = document.getElementById('wheel-prev-btn');
    const nextBtn = document.getElementById('wheel-next-btn');

    function applyWheelSelection(idx) {
      const clamped = Math.max(0, Math.min(filtered.length - 1, idx));
      selectedIdx = clamped;
      const bx = filtered[clamped];
      state.selectedWheelBox = bx.caja;

      wheelItems.forEach((el, i) => {
        const dist = Math.abs(i - clamped);
        el.classList.toggle('is-selected', dist === 0);
        el.classList.toggle('is-near', dist === 1);
      });

      metaPill.textContent = `${bx.count} ${bx.count === 1 ? 'libro' : 'libros'}${bx.tamano ? ' · ' + bx.tamano : ''}`;
      previewEl.textContent = bx.topGenres.length ? `Géneros: ${bx.topGenres.join(' · ')}` : 'Sin género registrado';
      verBtn.textContent = `VER CAJA ${bx.caja}`;
      prevBtn.disabled = clamped === 0;
      nextBtn.disabled = clamped === filtered.length - 1;
    }

    function scrollToWheelIndex(idx, smooth = true) {
      const clamped = Math.max(0, Math.min(filtered.length - 1, idx));
      viewport.scrollTo({
        top: clamped * ITEM_HEIGHT,
        behavior: smooth ? 'smooth' : 'auto',
      });
      applyWheelSelection(clamped);
    }

    // Set initial scroll position immediately without jump
    viewport.scrollTop = selectedIdx * ITEM_HEIGHT;
    applyWheelSelection(selectedIdx);

    let rafId = null;
    viewport.addEventListener('scroll', () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const idx = Math.round(viewport.scrollTop / ITEM_HEIGHT);
        if (idx !== selectedIdx) {
          applyWheelSelection(idx);
        }
      });
    }, { passive: true });

    wheelItems.forEach((item) => {
      item.addEventListener('click', () => {
        const idx = Number(item.dataset.wheelIdx);
        scrollToWheelIndex(idx, true);
      });
    });

    prevBtn.addEventListener('click', () => scrollToWheelIndex(selectedIdx - 1, true));
    nextBtn.addEventListener('click', () => scrollToWheelIndex(selectedIdx + 1, true));

    verBtn.addEventListener('click', () => {
      const bx = filtered[selectedIdx];
      if (bx) openBoxBooks(bx.caja);
    });

    els.results.querySelectorAll('.box-card').forEach((card) => {
      card.addEventListener('click', () => {
        const caja = Number(card.dataset.caja);
        state.selectedWheelBox = caja;
        openBoxBooks(caja);
      });
    });
  }

  function renderExploreView() {
    els.quickJump.classList.add('hidden');
    const tokens = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const list = state.exploreMode === 'generos' ? state.genres : state.authors;

    const filtered = list.filter((item) => {
      for (const t of tokens) {
        if (!item.norm.includes(t)) return false;
      }
      return true;
    });

    const shown = filtered.slice(0, 120);
    els.statusBar.innerHTML = `
      <span>Mostrando ${formatNumber(shown.length)} de ${formatNumber(filtered.length)} ${state.exploreMode === 'generos' ? 'géneros' : 'autores'}</span>
    `;
    els.loadMoreWrap.classList.add('hidden');

    if (shown.length === 0) {
      els.results.className = 'results';
      els.results.innerHTML = `
        <div class="empty-state">
          <h3>Sin coincidencias</h3>
          <p>Probá buscando otro término.</p>
        </div>
      `;
      return;
    }

    els.results.className = 'results';
    els.results.innerHTML = shown.map((item) => `
      <button class="explore-item" type="button" data-value="${escapeHtml(item.name)}">
        <span class="explore-name">${escapeHtml(item.name)}</span>
        <span class="explore-count">${formatNumber(item.count)}</span>
      </button>
    `).join('');

    els.results.querySelectorAll('.explore-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        if (state.exploreMode === 'generos') {
          state.query = '';
          els.searchInput.value = '';
          els.clearSearchBtn.classList.add('hidden');
          state.boxFilter = '';
          state.genreFilter = value;
        } else {
          state.boxFilter = '';
          state.genreFilter = '';
          state.query = value;
          els.searchInput.value = value;
          els.clearSearchBtn.classList.remove('hidden');
        }
        setTab('libros');
      });
    });
  }

  function openBoxBooks(cajaNum) {
    state.query = '';
    els.searchInput.value = '';
    els.clearSearchBtn.classList.add('hidden');
    state.boxFilter = String(cajaNum);
    state.genreFilter = '';
    state.sizeFilter = '';
    state.sortBy = 'caja';
    setTab('libros');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openBookModal(book) {
    const rows = [
      ['Posición en caja', book.indice !== null ? `#${book.indice}` : '—'],
      ['Tamaño de caja', book.tamano || '—'],
      ['Editorial', book.editorial || '—'],
      ['Género', book.genero || '—'],
      ['ISBN', book.isbn || '—'],
    ];
    if (book.precio) rows.push(['Precio', book.precio]);
    if (book.archivo) rows.push(['Archivo origen', book.archivo]);

    els.bookModalBody.innerHTML = `
      <h2 id="modal-book-title" class="detail-title">${escapeHtml(book.titulo)}</h2>
      <p class="detail-author">${escapeHtml(book.autor || 'Autor no registrado')}</p>

      <div class="detail-box-banner">
        <div>
          <strong>Caja ${book.caja}</strong>
          ${book.tamano ? ` · Tamaño ${escapeHtml(book.tamano)}` : ''}
        </div>
        ${book.indice !== null ? `<span>Libro #${book.indice}</span>` : ''}
      </div>

      <dl class="detail-list">
        ${rows.map(([label, val]) => `
          <div class="detail-row">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(val)}</dd>
          </div>
        `).join('')}
      </dl>

      <div class="sheet-actions">
        <button id="modal-go-box" class="primary-btn" type="button">Ver todos los libros de la Caja ${book.caja}</button>
        ${book.autor ? `<button id="modal-go-author" class="secondary-btn" type="button">Buscar más de ${escapeHtml(book.autor)}</button>` : ''}
        ${book.genero ? `<button id="modal-go-genre" class="secondary-btn" type="button">Filtrar género: ${escapeHtml(book.genero)}</button>` : ''}
      </div>
    `;

    document.getElementById('modal-go-box').addEventListener('click', () => {
      closeModal(els.bookModal);
      openBoxBooks(book.caja);
    });

    document.getElementById('modal-go-author')?.addEventListener('click', () => {
      closeModal(els.bookModal);
      state.boxFilter = '';
      state.genreFilter = '';
      state.query = book.autor;
      els.searchInput.value = book.autor;
      els.clearSearchBtn.classList.remove('hidden');
      setTab('libros');
    });

    document.getElementById('modal-go-genre')?.addEventListener('click', () => {
      closeModal(els.bookModal);
      state.boxFilter = '';
      state.query = '';
      els.searchInput.value = '';
      els.clearSearchBtn.classList.add('hidden');
      state.genreFilter = book.genero;
      setTab('libros');
    });

    openModal(els.bookModal);
  }

  function openInfoModal() {
    const m = state.metadata;
    const created = m.fecha_creacion ? m.fecha_creacion.slice(0, 16).replace('T', ' ') : '—';

    els.infoModalBody.innerHTML = `
      <div class="info-note">
        Esta versión lee directamente <strong>${escapeHtml(state.dbSourceName)}</strong> en tu navegador.
        Cuando agregues más cajas a <code>Base/tgl1.db</code> y las subas a GitHub, el catálogo se actualizará automáticamente.
      </div>

      <dl class="detail-list">
        <div class="detail-row"><dt>Versión</dt><dd>${escapeHtml(m.version || 'TGL-1')}</dd></div>
        <div class="detail-row"><dt>Volúmenes cargados</dt><dd>${formatNumber(state.books.length)}</dd></div>
        <div class="detail-row"><dt>Cajas registradas</dt><dd>${formatNumber(state.boxes.length)}</dd></div>
        <div class="detail-row"><dt>Géneros</dt><dd>${formatNumber(state.genres.length)}</dd></div>
        <div class="detail-row"><dt>Autores</dt><dd>${formatNumber(state.authors.length)}</dd></div>
        <div class="detail-row"><dt>Fecha exportación</dt><dd>${escapeHtml(created)}</dd></div>
      </dl>

      <div class="info-note">
        <strong>Tip para iPhone (iOS):</strong> en Safari tocá el botón <em>Compartir</em> y elegí <em>“Agregar a pantalla de inicio”</em> para usar BiblioMóvil como una app (incluso sin conexión).
      </div>

      <div class="sheet-actions">
        <button id="reload-db-btn" class="primary-btn" type="button">Actualizar desde Base/tgl1.db</button>
        <button id="pick-local-db-btn" class="secondary-btn" type="button">Probar otro archivo .db local</button>
      </div>
    `;

    document.getElementById('reload-db-btn').addEventListener('click', async () => {
      closeModal(els.infoModal);
      await loadDatabaseFromUrl(DEFAULT_DB_PATH);
    });

    document.getElementById('pick-local-db-btn').addEventListener('click', () => {
      els.dbFileInput.click();
    });

    openModal(els.infoModal);
  }

  function openModal(backdrop) {
    backdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(backdrop) {
    backdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function showLoading(message) {
    els.results.className = 'results';
    els.loadMoreWrap.classList.add('hidden');
    els.results.innerHTML = `
      <div class="loading-state">
        <div class="spinner" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function showLoadError(err) {
    els.statsPillText.textContent = 'Sin base cargada';
    els.loadMoreWrap.classList.add('hidden');
    els.results.className = 'results';
    const isFileProtocol = location.protocol === 'file:';
    els.results.innerHTML = `
      <div class="empty-state">
        <h3>No se pudo cargar ${escapeHtml(DEFAULT_DB_PATH)}</h3>
        <p>${isFileProtocol
          ? 'Abriste el archivo directamente (file://). Para probarlo en tu Mac usá un servidor local o seleccioná el archivo .db manualmente.'
          : escapeHtml(err?.message || 'Error desconocido al cargar la base.')}</p>
        <button id="error-pick-db-btn" class="primary-btn" type="button">Seleccionar archivo tgl1.db</button>
      </div>
    `;
    document.getElementById('error-pick-db-btn').addEventListener('click', () => {
      els.dbFileInput.click();
    });
  }

  init();
})();
