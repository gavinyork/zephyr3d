import type { LoadingScreen } from '@zephyr3d/scene';
import { ENGINE_LOGO_SVG } from './splash_logo';

/** Id of the splash screen element */
const ID = 'zephyr-splash';
/** Class fading the splash screen out */
const HIDDEN_CLASS = `${ID}-hidden`;
/** Global the splash screen script puts its {@link LoadingScreen} in */
export const SPLASH_SCREEN_GLOBAL = 'zephyrLoadingScreen';

function parseColor(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const parts = rgb[1].split(',').map((v) => parseFloat(v) / 255);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [0.12, 0.12, 0.12];
}

/**
 * The editor's default splash screen: the engine logo, a progress bar, shown once there is
 * progress to show, and a message line.
 *
 * @remarks
 * `style` goes in the head and `markup` first in the body, so the browser draws it
 * before any script loads. `script`, run right after the markup, implements
 * {@link LoadingScreen} on it as `window.zephyrLoadingScreen` and shows the errors
 * thrown while starting, from loading the engine modules on.
 *
 * @param background - CSS color of the background; the logo text turns dark on light ones
 */
export function generateSplashScreenHTML(background: string) {
  const [r, g, b] = parseColor(background);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
  const foreground = light ? '#333333' : '#ffffff';
  const style = `<style>
      #${ID} {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        background: ${background};
        color: ${foreground};
        font: 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        transition: opacity 0.3s ease;
      }
      #${ID}.${HIDDEN_CLASS} {
        opacity: 0;
        pointer-events: none;
      }
      #${ID}-logo svg {
        display: block;
        width: min(360px, 60vw);
        height: auto;
      }
      #${ID}-progress {
        width: min(280px, 50vw);
        height: 3px;
        border-radius: 2px;
        background: color-mix(in srgb, currentColor 18%, transparent);
        overflow: hidden;
      }
      #${ID}-progress[hidden] {
        display: none;
      }
      #${ID}-progress > div {
        width: 0;
        height: 100%;
        background: #4cb2a7;
        transition: width 0.2s ease-out;
      }
      #${ID}-message {
        min-height: 1.2em;
        max-width: 80vw;
        text-align: center;
        white-space: pre-wrap;
        opacity: 0.7;
      }
    </style>`;
  const markup = `<div id="${ID}" role="status" aria-live="polite">
      <div id="${ID}-logo">${ENGINE_LOGO_SVG}</div>
      <div id="${ID}-progress" hidden><div></div></div>
      <div id="${ID}-message">Loading</div>
    </div>`;
  const script = `(() => {
        const root = document.getElementById('${ID}');
        const progress = document.getElementById('${ID}-progress');
        const message = document.getElementById('${ID}-message');
        let hidden = null;
        const screen = {
          setProgress(fraction) {
            // Shown from the first progress on; without any, only the message shows
            progress.hidden = false;
            progress.firstElementChild.style.width = (Math.min(Math.max(fraction, 0), 1) * 100).toFixed(1) + '%';
          },
          setMessage(text) {
            message.textContent = text;
          },
          showError(text) {
            // Failures after the splash screen is gone are not startup failures
            if (!hidden) {
              root.setAttribute('role', 'alert');
              progress.remove();
              message.textContent = 'Startup failed: ' + text;
            }
          },
          hide() {
            hidden = hidden || new Promise((resolve) => {
              const remove = () => {
                root.remove();
                resolve();
              };
              root.classList.add('${HIDDEN_CLASS}');
              root.addEventListener('transitionend', remove, { once: true });
              setTimeout(remove, 1000);
            });
            return hidden;
          }
        };
        window.${SPLASH_SCREEN_GLOBAL} = screen;
        window.addEventListener('error', (event) => {
          if (event.message) {
            screen.showError(event.message);
          }
        });
        window.addEventListener('unhandledrejection', (event) => {
          screen.showError(event.reason?.message || String(event.reason || 'Unhandled promise rejection'));
        });
      })();`;
  return { style, markup, script };
}

/**
 * Puts the default splash screen on the current page, for previews.
 * @returns Its loading screen
 */
export function installSplashScreen(background: string): LoadingScreen {
  const html = generateSplashScreenHTML(background);
  document.head.insertAdjacentHTML('beforeend', html.style);
  document.body.insertAdjacentHTML('beforeend', html.markup);
  // Scripts in inserted markup do not run
  const script = document.createElement('script');
  script.textContent = html.script;
  document.body.appendChild(script);
  return (window as unknown as Record<string, LoadingScreen>)[SPLASH_SCREEN_GLOBAL];
}
