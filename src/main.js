export function mountApp(root) {
  root.textContent = 'Seduh Score Next';
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  mountApp(document.getElementById('app'));
}
