export function createControlPanel(title) {
  const root = document.getElementById('ui');
  if (!root) {
    throw new Error('Missing UI root #ui');
  }
  root.replaceChildren();

  const panel = document.createElement('div');
  panel.className = 'panel';

  const heading = document.createElement('div');
  heading.className = 'title';
  heading.textContent = title;

  const status = document.createElement('div');
  status.className = 'status';

  const buttons = document.createElement('div');
  buttons.className = 'buttons';

  panel.append(heading, status, buttons);
  root.append(panel);

  return {
    addButton(label, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', onClick);
      buttons.append(button);
      return button;
    },
    setStatus(text) {
      status.textContent = text;
    },
    setActive(button, active) {
      button.classList.toggle('active', active);
    }
  };
}

