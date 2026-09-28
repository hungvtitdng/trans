'use strict';

(() => {
  const api = window.api;
  const source = document.getElementById('source');
  const caption = document.getElementById('caption');
  const toggleSource = document.getElementById('toggleSource');

  const load = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // bỏ qua
    }
  };

  let size = Number(load('overlay-size', 30));
  let hideSource = load('overlay-hide-source', '0') === '1';
  let lastShownId = 0;

  function apply() {
    document.documentElement.style.setProperty('--size', `${size}px`);
    document.body.classList.toggle('hide-source', hideSource);
    toggleSource.textContent = hideSource ? 'Hiện câu gốc' : 'Ẩn câu gốc';
  }

  document.getElementById('smaller').addEventListener('click', () => {
    size = Math.max(16, size - 2);
    save('overlay-size', size);
    apply();
  });
  document.getElementById('bigger').addEventListener('click', () => {
    size = Math.min(72, size + 2);
    save('overlay-size', size);
    apply();
  });
  toggleSource.addEventListener('click', () => {
    hideSource = !hideSource;
    save('overlay-hide-source', hideSource ? '1' : '0');
    apply();
  });
  document.getElementById('close').addEventListener('click', () => api.closeOverlay());

  api.onCaption((msg) => {
    if (msg.type === 'interim' || msg.type === 'final') {
      source.textContent = msg.text;
    } else if (msg.type === 'interimTranslation') {
      caption.textContent = msg.text;
      caption.classList.add('interim');
    } else if (msg.type === 'translated' && msg.id > lastShownId) {
      lastShownId = msg.id;
      caption.textContent = msg.text;
      caption.classList.remove('interim');
    }
  });

  apply();
})();
