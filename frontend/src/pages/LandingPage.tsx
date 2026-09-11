const LANGS = ["Tamil", "Thanglish", "Telugu", "Malayalam", "Kannada", "Hindi", "Bengali", "Marathi", "Punjabi", "Gujarati", "Odia", "English"];

const FEATURES: { big?: boolean; icon: JSX.Element; title: string; body: string; demo?: JSX.Element }[] = [
  {
    big: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h10M4 18h13" /></svg>,
    title: "Captions that get your language right",
    body: "Tamil, Thanglish and 10 more — correct spellings, the natural English-mix, and a style that matches your channel. Animated word-by-word, burned clean into the export.",
    demo: <div className="cy-demo"><b className="cy-strike">vanakam</b> <b className="cy-gradtx">→ வணக்கம்</b></div>,
  },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 12h3l2-7 4 14 2-7h4" /></svg>, title: "Silence remover", body: "Finds every pause and dead-air gap and tightens the cut — so the edit never drags." },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>, title: "Retake remover", body: "Flubbed a line and said it again? It keeps your last clean take and drops the rest." },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4M11 8v6M8 11h6" /></svg>, title: "Auto-zoom", body: "Punch-ins land on the beat automatically, aimed right at you." },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l5-4 4 3 4-5 5 6" /></svg>, title: "Grades & filters", body: "Cinematic looks on your own frame — one tap, timed to any clip." },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>, title: "Export anywhere", body: "9:16, 1:1 or 16:9, MP4 or SRT — sized for Reels, Shorts and YouTube." },
];

const STEPS = [
  { n: "1", title: "Drop your clip", body: "Upload straight from the browser — phone footage, screen recording, anything. Nothing to install." },
  { n: "2", title: "Let ceyonai edit", body: "Captions, silence cuts, retakes and zooms happen automatically. Tweak anything you like." },
  { n: "3", title: "Export & post", body: "Pick your shape, hit export, and your finished reel is ready to upload minutes later." },
];

const STATS = [
  ["12", "Indian languages"], ["~10×", "faster than manual"], ["0", "plugins to install"], ["100%", "in your browser"],
];

const REVIEWS = [
  { av: "M", who: "Meera S.", role: "food creator · Chennai", quote: "My Thanglish captions used to take an hour to fix by hand. Now they're just… right. I post two reels a day instead of two a week." },
  { av: "A", who: "Aravind K.", role: "tech explainer · Bengaluru", quote: "The retake remover reads my mind. I ramble, redo the line, and it quietly keeps the good one. Editing stopped being a chore." },
  { av: "P", who: "Priya R.", role: "educator · Coimbatore", quote: "Uploaded a 14-minute raw talk, got back a tight 6-minute cut with captions. Retention on that video was my best ever." },
];

const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 12l5 5L20 7" /></svg>;

const PLANS = [
  { name: "Free", price: "₹0", per: "/forever", desc: "Everything you need to try a full edit.", feats: ["15 min of video / month", "All captions & auto-edits", "No watermark"], cta: "Start free", hot: false },
  { name: "Creator", price: "₹499", per: "/month", desc: "For creators posting every week.", feats: ["5 hours of video / month", "1080p exports, all styles", "Priority AI & 50 GB storage"], cta: "Get Creator", hot: true },
  { name: "Studio", price: "₹1,299", per: "/month", desc: "For teams and daily publishers.", feats: ["Unlimited video", "4K exports + brand kits", "Team seats & support"], cta: "Get Studio", hot: false },
];

export function LandingPage() {
  const start = () => { window.location.hash = "#/app"; };
  const login = () => { window.location.hash = "#/login"; };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="cy">
      <header className="cy-nav">
        <div className="cy-wrap cy-nav-in">
          <a className="cy-logo" href="#/">
            <span className="cy-logo-mark"><svg viewBox="0 0 24 24" fill="#08101a"><path d="M8 5v14l11-7z" /></svg></span>
            <span>ceyon<i>ai</i></span>
          </a>
          <nav className="cy-nav-links">
            <button onClick={() => go("product")}>Product</button>
            <button onClick={() => go("pricing")}>Pricing</button>
            <button onClick={() => go("stories")}>Stories</button>
          </nav>
          <div className="cy-nav-cta">
            <button className="cy-btn ghost" onClick={login}>Log in</button>
            <button className="cy-btn grad" onClick={start}>Start free</button>
          </div>
        </div>
      </header>

      <section className="cy-hero">
        <div className="cy-orb a" /><div className="cy-orb b" />
        <div className="cy-wrap">
          <span className="cy-pill">◆ AI video editor · built in India</span>
          <h1>Raw footage in.<br /><span className="cy-gradtx">Finished reel out.</span></h1>
          <p className="cy-hero-sub">ceyonai captions, trims and polishes your video on its own — accurate in Tamil, Thanglish and every Indian language your audience actually speaks. No timeline wrangling, no plugins.</p>
          <div className="cy-hero-cta">
            <button className="cy-btn grad lg" onClick={start}>Start free →</button>
            <button className="cy-btn ghost lg" onClick={() => go("product")}>▶ Watch 60-sec demo</button>
          </div>
          <div className="cy-hero-trust">
            <span><span className="cy-dot" /> <b>12</b> Indian languages</span>
            <span><span className="cy-dot" /> Runs in your browser</span>
            <span><span className="cy-dot" /> No watermark on free</span>
          </div>

          <div className="cy-win">
            <div className="cy-win-bar"><i /><i /><i /><span>ceyonai · my-reel.mp4</span></div>
            <div className="cy-win-body">
              <div className="cy-win-preview">
                <div className="cy-win-play"><svg viewBox="0 0 24 24" fill="#eef1fb"><path d="M8 5v14l11-7z" /></svg></div>
                <div className="cy-win-cap"><b>naan <span className="cy-hl">ready</span> pannitten</b></div>
              </div>
              <div className="cy-win-side">
                <div className="cy-win-tool"><div className="cy-wt-t">Auto captions <em>Tamil · Thanglish</em></div><div className="cy-wt-s">Word-perfect, styled, animated.</div><div className="cy-chipline"><b>Neon</b><b>Karaoke</b><b>Bold pop</b></div></div>
                <div className="cy-win-tool"><div className="cy-wt-t">Silence remover <em>−0:47</em></div><div className="cy-wt-s">Dead air detected and cut.</div>
                  <div className="cy-wave">{[40, 70, 90, 55, 80, 35, 65, 95, 50, 75, 45, 85].map((h, i) => <i key={i} style={{ height: h + "%" }} />)}</div>
                </div>
                <div className="cy-win-tool"><div className="cy-wt-t">Retake remover <em>kept take 3</em></div><div className="cy-wt-s">Only your best line stays.</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cy-trust">
        <div className="cy-wrap">
          <p>Captions your audience reads in their own language</p>
          <div className="cy-marq">{LANGS.map((l, i) => <b key={l} className={i === 0 ? "on" : ""}>{l}</b>)}</div>
        </div>
      </section>

      <section className="cy-sec" id="product">
        <div className="cy-wrap">
          <div className="cy-sec-head"><span className="cy-pill">the toolkit</span><h2>Everything after you<br />stop recording.</h2><p>One upload. ceyonai handles the parts that used to eat your evening.</p></div>
          <div className="cy-bento">
            {FEATURES.map((f) => (
              <div key={f.title} className={"cy-card" + (f.big ? " big" : "")}>
                {f.big && <div className="cy-cardglow" />}
                <div className="cy-ic">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                {f.demo}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cy-sec cy-tight">
        <div className="cy-wrap">
          <div className="cy-sec-head"><span className="cy-pill">how it works</span><h2>Three steps. One coffee.</h2></div>
          <div className="cy-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="cy-step"><div className="cy-stepn">{s.n}</div><h3>{s.title}</h3><p>{s.body}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="cy-sec cy-tight">
        <div className="cy-wrap">
          <div className="cy-stats">
            {STATS.map(([n, l]) => <div key={l} className="cy-stat"><b className="cy-gradtx">{n}</b><span>{l}</span></div>)}
          </div>
        </div>
      </section>

      <section className="cy-sec cy-tight" id="stories">
        <div className="cy-wrap">
          <div className="cy-sec-head"><span className="cy-pill">stories</span><h2>Made for creators<br />who ship fast.</h2></div>
          <div className="cy-revs">
            {REVIEWS.map((r) => (
              <div key={r.who} className="cy-rev">
                <div className="cy-rev-st">★★★★★</div>
                <p>“{r.quote}”</p>
                <div className="cy-rev-who"><div className="cy-rev-av">{r.av}</div><div><b>{r.who}</b><span>{r.role}</span></div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cy-sec cy-tight" id="pricing">
        <div className="cy-wrap">
          <div className="cy-sec-head"><span className="cy-pill">pricing</span><h2>Start free.<br />Upgrade when you scale.</h2></div>
          <div className="cy-price">
            {PLANS.map((p) => (
              <div key={p.name} className={"cy-plan" + (p.hot ? " hot" : "")}>
                {p.hot && <div className="cy-tagpop">Most popular</div>}
                <h3>{p.name}</h3>
                <div className="cy-amt">{p.price}<span>{p.per}</span></div>
                <div className="cy-plan-desc">{p.desc}</div>
                <ul>{p.feats.map((ft) => <li key={ft}>{CHECK} {ft}</li>)}</ul>
                <button className={"cy-btn " + (p.hot ? "grad" : "ghost")} onClick={start}>{p.cta}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cy-sec cy-tight">
        <div className="cy-wrap">
          <div className="cy-ctaband">
            <div className="cy-orb a" style={{ left: "auto", right: "-120px", top: "-120px" }} />
            <h2>Your next reel is<br />a coffee away.</h2>
            <p>Upload a clip and watch ceyonai turn it into something ready to post — free, no card, no install.</p>
            <button className="cy-btn grad lg" onClick={start}>Start creating free →</button>
          </div>
        </div>
      </section>

      <footer className="cy-foot">
        <div className="cy-wrap cy-foot-in">
          <span>© 2026 ceyonai · Made in India for Indian creators</span>
          <span><a href="#/">Privacy</a><a href="#/">Terms</a><a href="#/">Contact</a></span>
        </div>
      </footer>
    </div>
  );
}
