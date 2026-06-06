let activeSource = null;

export function startScan(profileSlug, opts = {}) {
  const onListing = opts.onListing || (() => {});
  const onSourceStart = opts.onSourceStart || (() => {});
  const onSourceProgress = opts.onSourceProgress || (() => {});
  const onSourceDone = opts.onSourceDone || (() => {});
  const onScanDone = opts.onScanDone || (() => {});
  const onScanError = opts.onScanError || (() => {});

  if (activeSource) activeSource.close();

  const overlay = document.getElementById('scan-progress');
  const sourceEl = overlay.querySelector('.scan-progress-source');
  const counterEl = overlay.querySelector('.scan-progress-counter');
  overlay.classList.remove('hidden');
  let foundCount = 0;
  let currentSource = '';

  const setHeader = () => {
    sourceEl.textContent = currentSource ? currentSource : 'Démarrage…';
    counterEl.textContent = '+' + foundCount;
  };
  setHeader();

  activeSource = new EventSource('/api/run-scan-stream?profile=' + encodeURIComponent(profileSlug));
  activeSource.onmessage = (msg) => {
    let event;
    try { event = JSON.parse(msg.data); } catch { return; }

    switch (event.type) {
      case 'scan-start':
        foundCount = 0; currentSource = ''; setHeader(); break;
      case 'source-start':
        currentSource = event.source; setHeader(); onSourceStart(event); break;
      case 'source-progress':
        onSourceProgress(event); break;
      case 'listing':
        foundCount += 1; setHeader(); onListing(event.listing); break;
      case 'source-done':
        onSourceDone(event); break;
      case 'scan-done':
        cleanup(); onScanDone(event); break;
      case 'scan-error':
        cleanup(); onScanError(event); break;
    }
  };
  activeSource.onerror = () => {
    cleanup();
    onScanError({ type: 'scan-error', message: 'Connexion interrompue' });
  };

  function cleanup() {
    overlay.classList.add('hidden');
    if (activeSource) { activeSource.close(); activeSource = null; }
  }

  return () => {
    if (activeSource) activeSource.close();
    activeSource = null;
    overlay.classList.add('hidden');
  };
}

export function isScanActive() {
  return activeSource != null;
}
