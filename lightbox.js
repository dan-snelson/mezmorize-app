(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('figure img'));
  if (!imgs.length || typeof HTMLDialogElement === 'undefined') return;

  var dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', 'Screenshot viewer');
  var big = document.createElement('img');
  var cap = document.createElement('p');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lightbox-close';
  btn.setAttribute('aria-label', 'Close');
  btn.innerHTML = '&times;';
  dlg.appendChild(btn);
  dlg.appendChild(big);
  dlg.appendChild(cap);
  document.body.appendChild(dlg);

  var idx = 0, trigger = null;

  function show(i) {
    idx = (i + imgs.length) % imgs.length;
    var img = imgs[idx];
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var fc = img.parentNode.querySelector('figcaption');
    if (!fc && img.closest('figure')) fc = img.closest('figure').querySelector('figcaption');
    cap.textContent = fc ? fc.textContent : '';
  }

  function open(i) {
    trigger = imgs[i];
    show(i);
    if (!dlg.open) dlg.showModal();
  }

  imgs.forEach(function (img, i) {
    img.classList.add('zoomable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.addEventListener('click', function () { open(i); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); }
    });
  });

  dlg.addEventListener('click', function () { dlg.close(); });
  btn.addEventListener('click', function (e) { e.stopPropagation(); dlg.close(); });
  dlg.addEventListener('keydown', function (e) {
    if (imgs.length < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
  });
  dlg.addEventListener('close', function () {
    big.removeAttribute('src');
    if (trigger) trigger.focus();
  });
})();
