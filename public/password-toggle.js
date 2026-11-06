document.querySelectorAll('[data-password-toggle]').forEach(button => {
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  button.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
  });
});
