import { useEffect, useState } from 'react';
import { useCurrentSnapshot, useLeagueStore } from '../state/leagueStore';
import { LeagueList } from './screens/LeagueList';
import { LeagueSetup } from './screens/LeagueSetup';
import { PeriodScreen } from './screens/PeriodScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { OnlineRooms } from './screens/OnlineRooms';
import { OnlineAdmin } from './screens/OnlineAdmin';
import { OnlinePlayer } from './screens/OnlinePlayer';
import { parseAdminBootstrap } from '../online/adminAccess';

type AppRoute =
  | { kind: 'local' }
  | { kind: 'rooms' }
  | { kind: 'admin'; gameId?: string; adminToken?: string; publicOrigin?: string }
  | { kind: 'player'; inviteToken?: string; rejoinToken?: string };

function routeFromHash(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '');
  const bootstrap = parseAdminBootstrap(window.location.hash, window.location.search);
  if (bootstrap) {
    window.history.replaceState(null, '', window.location.pathname);
    return { kind: 'admin', adminToken: bootstrap.token, publicOrigin: bootstrap.publicOrigin };
  }
  if (hash === 'admin') return { kind: 'admin' };
  if (hash.startsWith('admin/')) return { kind: 'admin', gameId: hash.slice('admin/'.length) };
  if (hash === 'play') return { kind: 'player' };
  if (hash.startsWith('join/')) return { kind: 'player', inviteToken: hash.slice('join/'.length) };
  if (hash.startsWith('firm/')) return { kind: 'player', rejoinToken: hash.slice('firm/'.length) };
  if (hash === 'local') return { kind: 'local' };
  return { kind: 'rooms' };
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const screen = useLeagueStore((s) => s.screen);
  const setScreen = useLeagueStore((s) => s.setScreen);
  const snapshot = useCurrentSnapshot();

  useEffect(() => {
    const updateRoute = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  if (route.kind === 'rooms') return <OnlineRooms onLocal={() => { window.location.hash = 'local'; }} />;

  if (route.kind === 'admin') {
    return <OnlineAdmin initialGameId={route.gameId} initialAdminToken={route.adminToken} initialPublicOrigin={route.publicOrigin} onBack={() => { window.location.hash = ''; }} />;
  }
  if (route.kind === 'player') {
    return (
      <OnlinePlayer
        initialInviteToken={route.inviteToken}
        initialRejoinToken={route.rejoinToken}
        onBack={() => { window.location.hash = ''; }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>М Э К О М</h1>
        <span className="hint">режим ведущего</span>
        <div className="spacer" />
        <button onClick={() => { window.location.hash = 'rooms'; }}>Онлайн-комнаты</button>

        {snapshot && (
          <>
            <span className="badge">{snapshot.league.name}</span>
            <span className="badge">период {snapshot.league.results.length}</span>
          </>
        )}

        <button
          className={screen === 'leagues' ? 'active' : ''}
          onClick={() => setScreen('leagues')}
        >
          Лиги
        </button>
        <button
          disabled={!snapshot}
          className={screen === 'setup' ? 'active' : ''}
          onClick={() => setScreen('setup')}
        >
          Настройки
        </button>
        <button
          disabled={!snapshot}
          className={screen === 'period' ? 'active' : ''}
          onClick={() => setScreen('period')}
        >
          Период
        </button>
        <button
          disabled={!snapshot}
          className={screen === 'history' ? 'active' : ''}
          onClick={() => setScreen('history')}
        >
          История
        </button>
      </header>

      {screen === 'leagues' && <LeagueList />}
      {screen === 'setup' && <LeagueSetup />}
      {screen === 'period' && <PeriodScreen />}
      {screen === 'history' && <HistoryScreen />}
    </div>
  );
}
