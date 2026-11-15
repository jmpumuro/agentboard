// Apply the saved preference before the app paints, including on the sign-in page.
(() => {
    let preference = 'system';
    try { preference = localStorage.getItem('agentboard.theme') || 'system'; } catch {}
    const theme = preference === 'light' || preference === 'dark'
        ? preference
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
})();
