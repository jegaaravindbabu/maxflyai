import { useState } from "react";

const CAPTION_LANGS = ["Tamil", "Thanglish", "Telugu", "Malayalam", "Hindi", "English"];

const STYLES = ["Neon", "Karaoke", "Bold Pop", "Minimal", "Highlight", "Wave"];

const CREATOR_FEATURES = [
  { ic: "🎚", title: "Studio-clean audio", sub: "One tap to denoise and level your voice. Phone-mic recordings that sound pro." },
  { ic: "✨", title: "Captions that pop", sub: "Word-by-word reveals, karaoke fills, bounce — the styles that stop the scroll." },
  { ic: "☁", title: "Nothing to install", sub: "Runs fully in your browser. Any laptop, any place — just upload and go." },
  { ic: "🚫", title: "Zero watermark", sub: "Clean exports on every plan, free included. Your video carries your name, not ours." },
];

const EDITORS = ["Premiere Pro", "DaVinci Resolve", "After Effects", "Final Cut Pro"];

const PLANS = [
  { name: "FREE", price: "₹0", per: "/mo", feats: ["5 min / month", "720p export", "No watermark"], cta: "Start free" },
  { name: "STARTER", price: "₹399", per: "/mo", feats: ["25 min / month", "1080p export", "10 GB storage"], cta: "Get Starter" },
  { name: "CREATOR", price: "₹799", per: "/mo", feats: ["80 min / month", "4K export", "All caption styles"], cta: "Get Creator", popular: true },
  { name: "PRO", price: "₹2,499", per: "/mo", feats: ["250 min / month", "5 team seats", "Priority AI"], cta: "Get Pro" },
];

const REVIEWS = [
  { n: "Sneha Reddy", r: "Cut my editing time from 3 hours to 20 minutes. And the Thanglish captions are spot on — no fixing spellings by hand anymore.", h: "YouTuber" },
  { n: "Arjun Menon", r: "The retake remover alone is worth it. It finds every 'wait, let me say that again' and quietly cleans it up.", h: "Course creator" },
  { n: "Kavya Nair", r: "Finally a tool that gets Tamil right instead of turning it into English mush. Exports straight to Premiere too.", h: "Reels creator" },
  { n: "Vishal Kumar", r: "It turned my rambly 12-minute video into a tight 8. Retention jumped the same week.", h: "Tech reviewer" },
];

const FAQS = [
  { q: "Do I need to install anything?", a: "Nope. ceyonai runs entirely in your browser. Upload a video, get captions, export — no downloads, no plugins, works on any laptop." },
  { q: "Which languages does it caption?", a: "Tamil, Thanglish, Telugu, Malayalam, Hindi and English — with transliteration and translation built in. Code-switching (Tamil + English in one line) is handled properly." },
  { q: "How accurate are the Tamil captions really?", a: "That's the whole point of ceyonai. It uses an Indic speech engine tuned for Indian languages and accents, so your words come out written right — not Anglicised guesses you have to retype." },
  { q: "What's the difference between silence and retake remover?", a: "Silence remover cuts dead air and long pauses. Retake remover spots repeated takes ('let me say that again') and keeps only your best one — then trims the rest automatically." },
  { q: "Can I take it into my editor?", a: "Yes. Export straight to Premiere Pro, DaVinci Resolve, After Effects and Final Cut, plus SRT / VTT / TXT if you just want the text." },
  { q: "Is there a watermark?", a: "Never. No watermark on any plan, including the free tier." },
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
            <span className="lp-logo-name">ceyon<span>ai</span></span>
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
        <div className="lp-eyebrow">✦ MADE FOR TAMIL &amp; INDIC CREATORS</div>
        <h1 className="lp-hero-title">Captions that finally<br />get <span className="grad">Tamil.</span></h1>
        <p className="lp-hero-sub">
          Upload your video — ceyonai captions it in Tamil, Thanglish or your language,
          gets the spelling and code-switching right, then trims the silences and retakes.
          Done in minutes, right in your browser.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn lg" onClick={start}>Start captioning free</button>
          <button className="lp-ghost lg" onClick={() => go("pricing")}>See plans</button>
        </div>
        <div className="lp-stars">★★★★★ <span>Made with Tamil creators, for Tamil creators</span></div>
        <div className="lp-hero-video"><VideoBox label="See it caption a Tamil clip" /></div>
      </section>

      {/* Feature spotlight 1 — captions */}
      <section className="lp-feat" id="features">
        <div className="lp-feat-text">
          <div className="lp-tag">REGIONAL CAPTIONS</div>
          <h2>It speaks <span className="grad">your language.</span></h2>
          <p>Tamil, Thanglish, Telugu, Malayalam, Hindi — ceyonai gets the words, the spellings and the English-Tamil mix right the first time. No more fixing "vanakkam" into something that isn't a word.</p>
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
          <h2>Keep only your <span className="grad">best take.</span></h2>
          <p>Fumbled a line and said it again? ceyonai catches the repeated takes and quietly keeps the clean one — so you never scrub the timeline hunting for "the good one."</p>
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
          <h2>Dead air, <span className="grad">deleted.</span></h2>
          <p>Every "ummm", every long pause that kills your pacing — trimmed automatically. Your video stays tight, so your viewers stay too.</p>
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
        <h2 className="lp-center-h">Styles that <span className="grad">stop the scroll.</span></h2>
        <p className="lp-center-p">Neon, karaoke, bold pop and more — one tap and your captions match your channel, animated word-by-word like the big creators.</p>
        <div className="lp-style-row">
          {STYLES.map((s) => (
            <div className="lp-style-card" key={s}><span className="lp-play sm">▶</span><div>{s}</div></div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="lp-grid-sec">
        <div className="lp-tag center">MORE FEATURES</div>
        <h2 className="lp-center-h">Everything else you <span className="grad">need.</span></h2>
        <div className="lp-export">
          <div className="lp-export-l">
            <div className="lp-export-title">Export to your editor</div>
            <div className="lp-export-sub">Send captions and cuts straight into your NLE — no retyping, no re-work.</div>
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
        <h2 className="lp-center-h">Simple pricing, <span className="grad">no surprises.</span></h2>
        <p className="lp-center-p">Start free. Upgrade only when your channel grows.</p>
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
        <h2 className="lp-center-h">Creators are <span className="grad">into it.</span></h2>
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
        <p className="lp-center-p">Questions, feedback, or a partnership? Reach out any time — we actually reply.</p>
        <a className="lp-btn lg" href="mailto:support@ceyonai.com">Email support@ceyonai.com</a>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <h2>Your next video, <span className="grad">captioned in minutes.</span></h2>
        <button className="lp-btn lg" onClick={start}>Start for free</button>
      </section>

      <footer className="lp-footer">
        <div className="lp-logo">
          <span className="lp-logo-mark">▶</span>
          <span className="lp-logo-name">ceyon<span>ai</span></span>
        </div>
        <div className="lp-foot-links">
          <button onClick={() => go("features")}>Features</button>
          <button onClick={() => go("pricing")}>Pricing</button>
          <button onClick={() => go("reviews")}>Reviews</button>
          <a href="mailto:support@ceyonai.com">Contact</a>
        </div>
        <div className="lp-foot-copy">© 2026 ceyonai — AI captions &amp; editing for Indian creators.</div>
      </footer>
    </div>
  );
}
