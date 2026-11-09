import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { XRayProvider } from './lib/xray';
import './styles/global.css';
import './styles/hall3d.css';
import './styles/pages.css';
import './styles/nav.css';
import './styles/motion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><XRayProvider><App /></XRayProvider></BrowserRouter></StrictMode>,
);
