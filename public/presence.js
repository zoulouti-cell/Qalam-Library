(() => {
  let individualAccount = false;
  const sendPresence = () => {
    if (!individualAccount || document.hidden) return;
    fetch('/api/presence', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
  };
  fetch('/api/session', { credentials: 'same-origin' }).then(r => r.json()).then(data => {
    individualAccount = data.authenticated === true && Boolean(data.email);
    if (individualAccount) sendPresence();
  }).catch(() => {});
  setInterval(sendPresence, 60000);
  document.addEventListener('visibilitychange', sendPresence);
})();
