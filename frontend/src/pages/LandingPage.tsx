import { useState } from "react";

const CAPTION_LANGS = ["Tamil", "Thanglish", "Telugu", "Malayalam", "Hindi", "English"];

const STYLES = ["Neon", "Karaoke", "Bold Pop", "Minimal", "Highlight", "Wave"];

const CREATOR_FEATURES = [
  { ic: "🎚", title: "Audio cleanup", sub: "One-tap enhance, denoise, and level your voice track." },
  { ic: "✨", title: "Caption animations", sub: "Word-by-word pops, karaoke fills, and bounce effects." },
  { ic: "☁", title: "Cloud editing", sub: "Everything runs in your browser — nothing to install." },
  { ic: "🚫", title: "No watermark", sub: "Your exports are clean, even on the free plan." },
];

const EDITORS = ["Premiere Pro", "DaVinci Resolve", "After Effects", "Final Cut Pro"];

const PLANS = [
  { name: "FREE", price: "₹0", per: "/mo", feats: ["5 min / month", "720p export", "No watermark"], cta: "Start free" },
  { name: "STARTER", price: "₹399", per: "/mo", feats: ["25 min / month", "1080p export", "10 GB storage"], cta: "Get Starter" },
  { name: "CREATOR", price: "₹799", per: "/mo", feats: ["80 min / month", "4K export", "All animations"], cta: "Get Creator", popular: true },
  { name: "PRO", price: "₹2,499", per: "/mo", feats: ["250 min / month", "5 team seats", "Priority AI"], cta: "Get Pro" },
];

const REVIEWS = [
  { n: "Sneha Reddy", r: "Cut my editing time from 3 hours to 20 minutes. The Thanglish captions are shockingly accurate.", h: "YouTuber · 240K" },
  { n: "Arjun Menon", r: "The retake remover alone is worth it. It finds every 'wait, let me say that again' and cleans it.", h: "Course creator" },
  { n: "Kavya Nair", r: "Finally a captioning tool that gets Tamil right. Exports straight to Premiere too.", h: "Reels creator" },
  { n: "Vishal Kumar", r: "Silence remover turned my rambly 12-min video into a tight 8. My retention jumped.", h: "Tech reviewer" },
];

const FAQS = [
  { q: "Do I need to install anything?", a: "No. maxfly runs entirely in your browser. Upload a video, get captions, and export — no downloads, no plugins." },
  { q: "Which languages are supported?", a: "Tamil, Thanglish, Telugu, Malayalam, Hindi and English, with transliteration and translation built in." },
  { q: "What's the difference between silence and retake remover?", a: "Silence remover cuts dead air and long pauses. Retake remover detects repeated takes ('let me say that again') and keeps only your best one." },
  { q: "Can it export to editors?", a: "Yes — export to Premiere Pro, DaVinci Resolve, After Effects and Final Cut, plus SRT / VTT / TXT." },
  { q: "Is there a watermark on exports?", a: "No watermark on any plan, including the free tier." },
  { q: "How accurate are the captions?", a: "Very — maxfly is tuned specifically for Indian languages and accents, so Tamil and Thanglish come out clean." },
];

function VideoBox({ portrait, label }: { portrait?: boolean; label?: string }) {
  return (
    <div className={"lp-video" + (portrait ? " portrait" : "")}>
      <div className="lp-video-inner">
        <span className="lp-play">▶</span>
        <span className="lp-video-label">{label || "Video preview"}</span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [lang, setLang] = useState("Tamil");
  const [open, setOpen] = useState<number | null>(0);

  const start = () => { window.location.hash = "#/app"; };
  const login = () => { window.location.hash = "#/login"; };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-in">
          <a className="lp-logo" href="#/">
            <span className="lp-logo-mark">▶</span>
            <span className="lp-logo-name">maxfly<span>.ai</span></span>
          </a>
          <nav className="lp-links">
            <button onClick={() => go("features")}>Features</button>
            <button onClick={() => go("pricing")}>Pricing</button>
            <button onClick={() => go("reviews")}>Reviews</button>
            <button onClick={() => go("contact")}>Contact</button>
          </nav>
          <div className="lp-nav-cta">
            <button className="lp-ghost" onClick={login}>Login</button>
            <button className="lp-btn" onClick={start}>Start creating</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-eyebrow">✦ BUILT FOR INDIAN CREATORS</div>
        <h1 className="lp-hero-title">Skip the boring<br />parts of <span className="grad">editing.</span></h1>
        <p className="lp-hero-sub">
          maxfly removes silences, cuts retakes, and adds beautiful regional-language
          subtitles — automatically. Tamil, Thanglish &amp; more, in seconds.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn lg" onClick={start}>Start editing free</button>
          <button className="lp-ghost lg" onClick={() => go("pricing")}>See plans</button>
        </div>
        <div className="lp-stars">★★★★★ <span>Loved by 2,000+ creators</span></div>
        <div className="lp-hero-video"><VideoBox label="Watch maxfly in action" /></div>
      </section>

      {/* Feature spotlight 1 — captions */}
      <section className="lp-feat" id="features">
        <div className="lp-feat-text">
          <div className="lp-tag">TEXT ENGINE</div>
          <h2>Caption it <span className="grad">yours.</span></h2>
          <p>Add strong regional captions in one tap. Type in Tamil, Thanglish or English — maxfly keeps the meaning and the vibe.</p>
          <div className="lp-lang">
            {CAPTION_LANGS.map((l) => (
              <button key={l} className={"lp-chip" + (lang === l ? " on" : "")} onClick={() => setLang(l)}>{l}</button>
            ))}
          </div>
        </div>
        <VideoBox portrait label={`${lang} captions`} />
      </section>

      {/* Feature spotlight 2 — retake remover */}
      <section className="lp-feat reverse">
        <div className="lp-feat-text">
          <div className="lp-tag">RETAKE REMOVER</div>
          <h2>Only your <span className="grad">best take.</span></h2>
          <p>Fumbled a line and said it again? maxfly detects repeated takes and quietly keeps the clean one — so you never scrub the timeline hunting for it.</p>
          <div className="lp-takes">
            <div className="lp-take bad"><span>TAKE 01</span> so guys, welcome back to my chann—</div>
            <div className="lp-take bad"><span>TAKE 02</span> so guys, welcome back to the sh— wait</div>
            <div className="lp-take good"><span>TAKE 03</span> so guys, welcome back — today we're talking about… ✓</div>
          </div>
        </div>
        <VideoBox portrait label="Best take kept" />
      </section>

      {/* Feature spotlight 3 — silence remover */}
      <section className="lp-feat">
        <div className="lp-feat-text">
          <div className="lp-tag">SILENCE REMOVER</div>
          <h2>Dead air? <span className="grad">Gone.</span></h2>
          <p>Those long "uhh… wait" moments that kill your pacing? maxfly finds every awkward pause and trims it, so your video always moves.</p>
          <div className="lp-wave">
            <div className="lp-wave-bars">{Array.from({ length: 40 }).map((_, i) => (
              <span key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 0.7)) * 60}%` }} />
            ))}</div>
            <div className="lp-wave-time"><span>5:14</span><span className="cut">− 0:47 cut</span></div>
          </div>
        </div>
        <VideoBox portrait label="Silences trimmed" />
      </section>

      {/* Caption styles strip */}
      <section className="lp-styles">
        <div className="lp-tag center">CAPTION STYLES</div>
        <h2 className="lp-center-h">Every style, <span className="grad">built in.</span></h2>
        <p className="lp-center-p">Neon, karaoke, bold pop and more — one click and your captions match your channel.</p>
        <div className="lp-style-row">
          {STYLES.map((s) => (
            <div className="lp-style-card" key={s}><span className="lp-play sm">▶</span><div>{s}</div></div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="lp-grid-sec">
        <div className="lp-tag center">MORE FEATURES</div>
        <h2 className="lp-center-h">Built for <span className="grad">creators.</span></h2>
        <div className="lp-export">
          <div className="lp-export-l">
            <div className="lp-export-title">Export to editors</div>
            <div className="lp-export-sub">Send captions and cuts straight into your NLE — no re-work.</div>
          </div>
          <div className="lp-export-chips">
            {EDITORS.map((e) => <span key={e} className="lp-echip">{e}</span>)}
          </div>
        </div>
        <div className="lp-fgrid">
          {CREATOR_FEATURES.map((f) => (
            <div className="lp-fcard" key={f.title}>
              <span className="lp-fic">{f.ic}</span>
              <div className="lp-fc-title">{f.title}</div>
              <div className="lp-fc-sub">{f.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-tag center">PRICING</div>
        <h2 className="lp-center-h">Simple plans, <span className="grad">real value.</span></h2>
        <p className="lp-center-p">Start free. Upgrade when your channel does.</p>
        <div className="lp-price-grid">
          {PLANS.map((p) => (
            <div className={"lp-price-card" + (p.popular ? " popular" : "")} key={p.name}>
              {p.popular && <div className="lp-pop">MOST POPULAR</div>}
              <div className="lp-price-name">{p.name}</div>
              <div className="lp-price-amt">{p.price}<span>{p.per}</span></div>
              <ul>{p.feats.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={"lp-btn full" + (p.popular ? "" : " ghost")} onClick={start}>{p.cta}</button>
            </div>
          ))}
        </div>
        <p className="lp-price-foot">Daily Pass and top-ups available inside the app.</p>
      </section>

      {/* Reviews */}
      <section className="lp-reviews" id="reviews">
        <div className="lp-tag center">REVIEWS</div>
        <h2 className="lp-center-h">They said it, <span className="grad">not us.</span></h2>
        <div className="lp-review-grid">
          {REVIEWS.map((r) => (
            <div className="lp-review" key={r.n}>
              <div className="lp-review-stars">★★★★★</div>
              <p>"{r.r}"</p>
              <div className="lp-review-who"><strong>{r.n}</strong><span>{r.h}</span></div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq">
        <div className="lp-tag center">FAQ</div>
        <h2 className="lp-center-h">Probably <span className="grad">answered here.</span></h2>
        <div className="lp-faq-list">
          {FAQS.map((f, i) => (
            <div className={"lp-faq-item" + (open === i ? " open" : "")} key={f.q}>
              <button className="lp-faq-q" onClick={() => setOpen(open === i ? null : i)}>
                {f.q}<span className="lp-faq-ic">{open === i ? "−" : "+"}</span>
              </button>
              {open === i && <div className="lp-faq-a">{f.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="lp-contact" id="contact">
        <div className="lp-tag center">CONTACT</div>
        <h2 className="lp-center-h">Talk to us, <span className="grad">we're human.</span></h2>
        <p className="lp-center-p">Questions, feedback, or a partnership? Reach out any time.</p>
        <a className="lp-btn lg" href="mailto:support@maxfly.ai">Email support@maxfly.ai</a>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <h2>Stop losing hours <span className="grad">to editing.</span></h2>
        <button className="lp-btn lg" onClick={start}>Start for free</button>
      </section>

      <footer className="lp-footer">
        <div className="lp-logo">
          <span className="lp-logo-mark">▶</span>
          <span className="lp-logo-name">maxfly<span>.ai</span></span>
        </div>
        <div className="lp-foot-links">
          <button onClick={() => go("features")}>Features</button>
          <button onClick={() => go("pricing")}>Pricing</button>
          <button onClick={() => go("reviews")}>Reviews</button>
          <a href="mailto:support@maxfly.ai">Contact</a>
        </div>
        <div className="lp-foot-copy">© 2026 maxfly.ai — AI video editing for Indian creators.</div>
      </footer>
    </div>
  );
}
