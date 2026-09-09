import { createRoot } from 'react-dom/client';
import { installHostedLinks } from './navigation.mjs';
import Workbench from '@pixelwall/workbench';
import '@pixelwall/globals.css';
import '@pixelwall/dialogs.css';
import '@pixelwall/workbench.css';

createRoot(document.getElementById('root')).render(<Workbench />);
// Desktop carries every asset; the served browser build installs its own shell.
if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('./sw.js', location.href), { scope: './', updateViaCache: 'none' }).catch(() => {});
  }, { once: true });
}
// Documentation opens at the explicitly compiled storefront; artwork stays local.
installHostedLinks(document, process.env.NEXT_PUBLIC_PIXELWALL_SITE_URL);
