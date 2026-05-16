document.addEventListener('DOMContentLoaded', () => {
  // Create a bait element that ad blockers typically target
  const bait = document.createElement('div');
  bait.className = 'ad ad-banner ads advertisement';
  bait.style.display = 'none';
  document.body.appendChild(bait);

  setTimeout(() => {
    // Check if the bait element is blocked (height 0 or display none by ad blocker)
    const adBlocked = bait.offsetHeight === 0 || window.getComputedStyle(bait).display === 'none';
    
    if (adBlocked) {
      const adBlockMessage = document.getElementById('adblock-message');
      if (adBlockMessage) {
        adBlockMessage.classList.remove('hidden');
      }
    }

    // Clean up bait element
    document.body.removeChild(bait);
  }, 1000);
});