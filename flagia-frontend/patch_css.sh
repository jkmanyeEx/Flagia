sed -i '' '/.app-mobile-header {/,/.sidebar-overlay {/d' src/style.css
sed -i '' '/.app-sidebar {/,/.sidebar-logout:hover {/d' src/style.css
sed -i '' '/.app-sidebar/d' src/style.css

cat << 'INNER_EOF' >> src/style.css

/* ── Top Navbar ── */
.app-top-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: white;
  border-bottom: 1px solid var(--color-border);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
.nav-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  max-width: 1280px;
  margin: 0 auto;
}
.nav-left, .nav-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
}
.nav-logo-icon {
  width: 28px;
  height: 28px;
  background: var(--color-primary);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-logo-text {
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--color-text-primary);
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 1rem;
}
.nav-link {
  background: transparent;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}
.nav-link:hover {
  background: var(--color-background);
  color: var(--color-text-primary);
}
.nav-link.active {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.nav-user {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.nav-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.875rem;
}
.nav-user-info {
  display: flex;
  flex-direction: column;
}
.nav-user-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.nav-user-role {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
INNER_EOF
