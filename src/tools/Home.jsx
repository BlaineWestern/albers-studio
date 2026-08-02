import React from 'react';

/** Landing — pick a tool. Each tool has its own route + API. */
export function Home(){
  return (
    <div className="app home">
      <header>
        <h1>Albers Studio</h1>
        <span className="sub">two tools · photograph transform · generative design</span>
      </header>
      <div className="tool-grid">
        <a className="tool-card" href="/photo" data-testid="home-photo">
          <div className="plabel">Tool · /photo</div>
          <h2>Photo → Textile</h2>
          <p>Load a photograph, set corners, flatten, and transform into a layered weave
            model, draft, and tapestry. Uses <code>POST /api/transform</code>.</p>
          <span className="go">Open photo tool →</span>
        </a>
        <a className="tool-card" href="/generate" data-testid="home-generate">
          <div className="plabel">Tool · /generate</div>
          <h2>Generate from inputs</h2>
          <p>Build a textile design from environmental readings and rug style fingerprints.
            Uses <code>POST /api/generate</code>.</p>
          <span className="go">Open generate tool →</span>
        </a>
      </div>
      <div className="readout home-note">
        Profiles saved from either tool feed Generate style priors via fingerprints.
        See <code>docs/generative-textile-methods.md</code>.
      </div>
    </div>
  );
}
