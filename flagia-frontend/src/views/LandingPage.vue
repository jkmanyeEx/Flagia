<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="landing">
    <!-- Nav -->
    <nav class="landing-nav">
      <div class="landing-nav-inner">
        <div class="landing-logo">
          <div class="landing-logo-icon">
            <img src="/logo.jpg" alt="Flagia" />
          </div>
          <span>Flagia</span>
        </div>
        <div class="landing-nav-actions">
          <button @click="router.push('/login')" class="btn btn-ghost btn-sm">{{ $t('auto.m_e225a6fd754f') }}</button>
          <button @click="router.push('/register')" class="btn btn-primary btn-sm">{{ $t('auto.m_22a4bea87413') }}</button>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="landing-hero">
      <div class="landing-hero-bg">
        <div class="landing-orb landing-orb-1"></div>
        <div class="landing-orb landing-orb-2"></div>
        <div class="landing-orb landing-orb-3"></div>
      </div>
      <div class="landing-hero-content">
        <div class="landing-hero-badge">
          <span class="landing-badge-dot"></span> {{ $t('auto.m_8ada951dab90') }} </div>
        <h1 class="landing-hero-title"> {{ $t('auto.m_cd26dc337a37') }} <span class="gradient-text">{{ $t('auto.m_d49e7d7f85cf') }}</span>{{ $t('auto.m_c6a37dff82fc') }}<br/> {{ $t('auto.m_a99611b905e7') }} </h1>
        <p class="landing-hero-desc"> {{ $t('auto.m_1dc125550edd') }}<br/> {{ $t('auto.m_25b1b3212118') }} </p>
        <div class="landing-hero-actions">
          <button @click="router.push('/register')" class="btn btn-primary btn-lg landing-cta"> {{ $t('auto.m_7bbd5bbabfd0') }} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/>
              <path d="m12 5 7 7-7 7"/>
            </svg>
          </button>
          <button @click="router.push('/login')" class="btn btn-outline btn-lg"> {{ $t('auto.m_3edbb5a6b4c3') }} </button>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="landing-features">
      <div class="landing-section-inner">
        <h2 class="landing-section-title">{{ $t('auto.m_73e54d924cc0') }}</h2>
        <p class="landing-section-desc">{{ $t('auto.m_49200ed09167') }}</p>
        
        <div class="landing-features-grid">
          <div class="feature-card">
            <div class="feature-icon feature-icon-purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <h3>{{ $t('auto.m_5510e0715196') }}</h3>
            <p>{{ $t('auto.m_8cdf6176b8b4') }}</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon feature-icon-blue">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/>
                <path d="M12.02 2C6.21 2 2 6.74 2 12c0 5.26 4.13 10 10 10 5.51 0 10-4.74 10-10 0-5.26-4.49-10-10-10z"/>
              </svg>
            </div>
            <h3>{{ $t('auto.m_7780fff69b64') }}</h3>
            <p>{{ $t('auto.m_d6fbcaf7fbd3') }}</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon feature-icon-green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <h3>{{ $t('auto.m_72997a11be87') }}</h3>
            <p>{{ $t('auto.m_9cdc5382d812') }}</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon feature-icon-amber">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3>{{ $t('auto.m_9e7f8a70bb20') }}</h3>
            <p>{{ $t('auto.m_956a9232220d') }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section class="landing-how">
      <div class="landing-section-inner">
        <h2 class="landing-section-title">{{ $t('auto.m_9def99b3fc95') }}</h2>
        <div class="landing-steps">
          <div class="step-card">
            <div class="step-number">1</div>
            <h3>{{ $t('auto.m_e2801a7e9786') }}</h3>
            <p>{{ $t('auto.m_b03b08701f46') }}</p>
          </div>
          <div class="step-connector"></div>
          <div class="step-card">
            <div class="step-number">2</div>
            <h3>{{ $t('auto.m_b22f31b43281') }}</h3>
            <p>{{ $t('auto.m_3475b1efddeb') }}</p>
          </div>
          <div class="step-connector"></div>
          <div class="step-card">
            <div class="step-number">3</div>
            <h3>{{ $t('auto.m_7da98d316224') }}</h3>
            <p>{{ $t('auto.m_4fb772c693cc') }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="landing-cta-section">
      <div class="landing-section-inner">
        <div class="landing-cta-card glass-dark">
          <h2>{{ $t('auto.m_262ab7496686') }}</h2>
          <p>{{ $t('auto.m_74ba912b204b') }}</p>
          <button @click="router.push('/register')" class="btn btn-primary btn-lg landing-cta"> {{ $t('auto.m_4d79f27bce8a') }} </button>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="landing-footer">
      <div class="landing-section-inner">
        <div class="landing-footer-inner">
          <span class="text-text-muted text-sm">© 2026 Flagia. Built for education.</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--color-background);
  overflow-x: hidden;
}

/* ── Nav ── */
.landing-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--color-background) 82%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 78%, transparent);
}
.landing-nav-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0.875rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.landing-logo {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-weight: 700;
  font-size: 1.125rem;
  color: var(--color-text-primary);
}
.landing-logo-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.landing-logo-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.landing-nav-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* ── Hero ── */
.landing-hero {
  position: relative;
  padding: 10rem 1.5rem 6rem;
  text-align: center;
  overflow: hidden;
}
.landing-hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.landing-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.15;
}
.landing-orb-1 {
  width: 500px;
  height: 500px;
  background: #4F46E5;
  top: -100px;
  right: -100px;
  animation: float 10s ease-in-out infinite;
}
.landing-orb-2 {
  width: 400px;
  height: 400px;
  background: #7C3AED;
  bottom: -100px;
  left: -100px;
  animation: float 12s ease-in-out infinite reverse;
}
.landing-orb-3 {
  width: 300px;
  height: 300px;
  background: #06B6D4;
  top: 40%;
  left: 50%;
  animation: float 8s ease-in-out infinite 2s;
}
@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 20px) scale(0.95); }
}

.landing-hero-content {
  position: relative;
  z-index: 1;
  max-width: 720px;
  margin: 0 auto;
}
.landing-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.875rem;
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-radius: 9999px;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}
.landing-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: statusPulse 2s ease-in-out infinite;
}
.landing-hero-title {
  font-size: 3rem;
  font-weight: 800;
  line-height: 1.2;
  color: var(--color-text-primary);
  margin-bottom: 1.25rem;
  letter-spacing: -0.025em;
}
.gradient-text {
  background: linear-gradient(135deg, #4F46E5, #7C3AED);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.landing-hero-desc {
  font-size: 1.0625rem;
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin-bottom: 2rem;
}
.landing-hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.btn-lg {
  padding: 0.875rem 1.75rem;
  font-size: 0.9375rem;
}
.landing-cta {
  box-shadow: 0 4px 16px rgba(79, 70, 229, 0.3);
}
.landing-cta:hover {
  box-shadow: 0 6px 24px rgba(79, 70, 229, 0.4);
  transform: translateY(-1px);
}

/* ── Sections ── */
.landing-section-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 1.5rem;
}
.landing-section-title {
  font-size: 1.75rem;
  font-weight: 700;
  text-align: center;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}
.landing-section-desc {
  font-size: 1rem;
  color: var(--color-text-secondary);
  text-align: center;
  margin-bottom: 3rem;
}

/* ── Features ── */
.landing-features {
  padding: 5rem 0;
}
.landing-features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}
.feature-card {
  padding: 2rem;
  border-radius: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: all 0.25s ease;
}
.feature-card:hover {
  box-shadow: 0 8px 24px hsl(var(--shadow-color) / 0.1);
  transform: translateY(-2px);
}
.feature-card h3 {
  font-size: 1.0625rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
  color: var(--color-text-primary);
}
.feature-card p {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  line-height: 1.65;
}
.feature-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.feature-icon-purple { background: #EEF2FF; color: #4F46E5; }
.feature-icon-blue { background: #EFF6FF; color: #2563EB; }
.feature-icon-green { background: #ECFDF5; color: #16A34A; }
.feature-icon-amber { background: #FEF3C7; color: #D97706; }

/* ── How it works ── */
.landing-how {
  padding: 5rem 0;
  background: var(--color-surface);
}
.landing-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
}
.step-card {
  text-align: center;
  flex: 1;
  max-width: 260px;
  padding: 2rem 1.5rem;
}
.step-number {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 700;
  font-size: 1.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
}
.step-card h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--color-text-primary);
}
.step-card p {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  line-height: 1.65;
}
.step-connector {
  width: 64px;
  height: 2px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* ── CTA ── */
.landing-cta-section {
  padding: 5rem 0;
}
.landing-cta-card {
  text-align: center;
  padding: 4rem 2rem;
  border-radius: 1.5rem;
}
.landing-cta-card h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: white;
  margin-bottom: 0.75rem;
}
.landing-cta-card p {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 1.5rem;
}

/* ── Footer ── */
.landing-footer {
  padding: 2rem 0;
  border-top: 1px solid var(--color-border);
}
.landing-footer-inner {
  text-align: center;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .landing-hero-title {
    font-size: 2rem;
  }
  .landing-features-grid {
    grid-template-columns: 1fr;
  }
  .landing-steps {
    flex-direction: column;
  }
  .step-connector {
    width: 2px;
    height: 32px;
  }
  .landing-hero-actions {
    flex-direction: column;
  }
}
</style>
