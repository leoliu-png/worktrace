import { signInWithGoogle } from './actions/auth';
import Link from 'next/link';
import { auth } from '@/auth';
import { LanguageToggle } from '@/components/language-toggle';
import { translate as t } from '@/lib/locale';
import { currentLocale } from '@/lib/locale-server';
import { homeLoginDestination } from '@/lib/home-login';
import { HomeIntegrations } from '@/components/home-integrations';

export default async function HomePage() {
  const [session, locale] = await Promise.all([auth(), currentLocale()]);
  const consoleDestination = homeLoginDestination(Boolean(session?.user));
  return (
    <div className="stitch-home">
      <header className="stitch-home-nav">
        <div className="stitch-home-nav-start">
          <b>WorkTrace</b>
        </div>
        <div className="stitch-home-nav-actions">
          <LanguageToggle locale={locale} />
          {session?.user ? <Link className="stitch-home-console" href="/console">{t(locale, 'console')}</Link> : <form action={signInWithGoogle}><button className="stitch-home-console" type="submit">{t(locale, 'console')}</button></form>}
          <button type="button" aria-label="Toggle theme">◐</button>
        </div>
      </header>

      <main className="stitch-home-main">
        <div className="stitch-home-route" aria-hidden="true"><i /><i /><i /><b /></div>
        <div className="stitch-home-content">
          <section className="stitch-home-hero" aria-labelledby="worktrace-title">
            <span className="stitch-home-kicker">WORKTRACE · AGENT LOG PIPELINE</span>
            <h1 id="worktrace-title">{locale === 'zh' ? '让每次 AI 交付\n都留下可追溯的轨迹' : 'Every AI delivery, traceable.'}</h1>
            <p>{t(locale, 'capture')}</p>
            {consoleDestination ? (
              <Link className="stitch-home-login" href={consoleDestination}>
                <span aria-hidden="true">▦</span>
                {t(locale, 'console')}
              </Link>
            ) : (
              <form action={signInWithGoogle}>
                <button className="stitch-home-login" type="submit">
                  <span aria-hidden="true">▦</span>
                  {t(locale, 'login')}
                </button>
              </form>
            )}
            <small>{t(locale, 'onlyDomain')}</small>
          </section>

          <HomeIntegrations baseUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-worktrace-domain'} locale={locale} />
        </div>
      </main>

    </div>
  );
}
