import { recoverModule } from './module-recovery';
window.addEventListener('vite:preloadError', event => recoverModule(event));
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme/themes.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
