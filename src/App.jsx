import React, { useState, useEffect } from 'react';
import { pathTool } from './shared.js';
import { Home } from './tools/Home.jsx';
import { PhotoTool } from './tools/PhotoTool.jsx';
import { GenerateTool } from './tools/GenerateTool.jsx';

/** Path router: / → home, /photo → transform tool, /generate → generative tool. */
export default function App(){
  const [tool, setTool] = useState(pathTool);

  useEffect(() => {
    const onNav = () => setTool(pathTool());
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);

  if (tool === 'photo') return <PhotoTool/>;
  if (tool === 'generate') return <GenerateTool/>;
  return <Home/>;
}
