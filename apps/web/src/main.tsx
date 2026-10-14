import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './styles.css';
import { MantineProvider } from '@mantine/core';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { App } from './App';

function Root() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('finance-theme') === 'dark' ? 'dark' : 'light'));
  useEffect(() => { localStorage.setItem('finance-theme', theme); }, [theme]);
  return <MantineProvider forceColorScheme={theme}><App theme={theme} onThemeChange={setTheme} /></MantineProvider>;
}

createRoot(document.getElementById('root')!).render(<Root />);
