import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/reset.css';
import './app/theme/tokens.css';
import './styles/typography.css';
import './styles/global.css';
import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

// The app renders immediately: no splash delay, no waiting on Telegram.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
