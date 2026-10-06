import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './theme.css'; // design tokens are needed by the auth screens before the Twin chunk loads

createRoot(document.getElementById('root')).render(<Root />);
