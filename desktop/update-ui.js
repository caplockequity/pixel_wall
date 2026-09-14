const api = window.pixelwallUpdates;
let lastActions = '';
function render(state) {
  if (!state) return;
  const titles = { idle: 'Check for updates', checking: 'Checking for updates…', available: `PixelWall ${state.version} is available`,
    downloading: 'Downloading update…', ready: 'Your update is ready', installing: 'Preparing to restart…', current: 'You’re up to date', error: 'Update needs attention', unsupported: 'Update unavailable' };
  const detail = { idle: `Installed version: ${state.currentVersion}`, checking: 'You can keep working while PixelWall checks.',
    available: `You have ${state.currentVersion}. Download and install this update here.`, downloading: `${Math.floor(state.progress || 0)}% downloaded. You can keep editing.`,
    ready: `Restart to install PixelWall ${state.version}. Your artwork will be saved first.`, installing: 'Please wait while PixelWall saves your artwork and verifies the update.',
    current: `You’re running PixelWall ${state.currentVersion}.`, error: '', unsupported: '' };
  document.getElementById('title').textContent = titles[state.status];
  document.getElementById('detail').textContent = detail[state.status];
  document.getElementById('message').textContent = state.message || '';
  const progress = document.getElementById('progress');
  progress.hidden = state.status !== 'downloading'; progress.value = state.progress || 0;
  const notes = document.getElementById('notes');
  notes.replaceChildren(...(['available', 'ready'].includes(state.status) ? state.notes || [] : []).map(text => {
    const li = document.createElement('li'); li.textContent = text; return li;
  }));
  const buttons = {
    idle: [['check', 'Check for updates']], checking: [['later', 'Keep editing']],
    available: [['download', 'Download update'], ['later', 'Later'], ['notes', 'Release notes']],
    downloading: [['later', 'Keep editing'], ['cancel', 'Cancel download']],
    ready: [['install', 'Restart to update'], ['later', 'Later']], installing: [],
    current: [['later', 'Done']], error: [[state.retry || 'check', 'Retry'], ['later', 'Later']], unsupported: [['later', 'Done']],
  }[state.status] || [];
  // Progress events must not replace focused buttons or interrupt keyboard activation.
  const key = JSON.stringify(buttons);
  if (key !== lastActions) {
    lastActions = key;
    document.getElementById('actions').replaceChildren(...buttons.map(([name, label], index) => {
      const button = document.createElement('button'); button.textContent = label;
      if (index === 0) button.className = 'primary';
      button.onclick = () => { void api.action(name); };
      return button;
    }));
  }
}
api.subscribe(render);
void api.state().then(render);
