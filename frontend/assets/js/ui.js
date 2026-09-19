/**
 * Peças de interface reutilizáveis: toast, animação de números, revelação ao
 * rolar, cópia para a área de transferência e confete.
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ Toast */
let toastTimer = null;

export function toast(message, variant = '') {
  const element = document.querySelector('[data-el="toast"]');
  if (!element) return;

  element.textContent = message;
  element.className = `toast is-visible${variant ? ` toast--${variant}` : ''}`;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.classList.remove('is-visible');
  }, 3600);
}

/* ------------------------------------------------------- Cópia de texto */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cai no fallback abaixo */
  }

  // Fallback para navegadores antigos / contexto sem HTTPS.
  try {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(helper);
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------ Contagem animada de valor */
export function countUp(element, from, to, format, duration = 900) {
  if (!element) return;
  if (prefersReducedMotion || from === to) {
    element.textContent = format(to);
    return;
  }

  const start = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------ Revelação ao rolar */
export function observeReveals(root = document) {
  const items = root.querySelectorAll('.reveal:not(.is-visible)');
  if (!items.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  items.forEach((item) => observer.observe(item));
}

/* ------------------------------------------------------------- Confete 🎉 */
export function celebrate({ pieces = 140, duration = 3200 } = {}) {
  const canvas = document.getElementById('confetti');
  if (!canvas || prefersReducedMotion) return;

  const context = canvas.getContext('2d');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();

  const colors = ['#8b5cf6', '#ec4899', '#22c55e', '#facc15', '#22d3ee', '#f97316'];
  const particles = Array.from({ length: pieces }, () => ({
    x: Math.random() * window.innerWidth,
    y: -20 - Math.random() * window.innerHeight * 0.4,
    size: 6 + Math.random() * 8,
    speed: 2 + Math.random() * 3.6,
    drift: -1.2 + Math.random() * 2.4,
    rotation: Math.random() * Math.PI,
    spin: -0.14 + Math.random() * 0.28,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const particle of particles) {
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.rotation += particle.spin;

      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.globalAlpha = Math.max(0, 1 - elapsed / duration);
      context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
      context.restore();
    }

    if (elapsed < duration) {
      requestAnimationFrame(frame);
    } else {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  requestAnimationFrame(frame);
  window.addEventListener('resize', resize, { once: true });
}
