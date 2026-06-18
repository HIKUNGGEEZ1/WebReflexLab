import { useEffect, useMemo, useState } from 'react';
import { database, firebaseReady } from './firebase';
import { ref, onValue, get } from 'firebase/database';
import './App.css';

const MODES = [
  { id: 'simple_reaction', label: 'Reaction', short: 'React', accent: 'green' },
  { id: 'quick_draw', label: 'Quick Draw', short: 'Draw', accent: 'blue' },
  { id: 'moba_objective', label: 'MOBA Objective', short: 'MOBA', accent: 'amber' },
];

const DIFFICULTIES = ['all', 'easy', 'normal', 'hard', 'chaos'];

const DEMO_LEADERBOARDS = {
  simple_reaction: [
    { attemptId: 'demo-r1', deviceId: 'esp32_demo01', playerName: 'SwiftDragon21', attemptScore: 812, reactionTimeMs: 188, result: 'success', playedAt: String(Date.now() - 240000) },
    { attemptId: 'demo-r2', deviceId: 'esp32_demo02', playerName: 'KeenHawk07', attemptScore: 764, reactionTimeMs: 236, result: 'success', playedAt: String(Date.now() - 680000) },
  ],
  quick_draw: [
    { attemptId: 'demo-q1', deviceId: 'esp32_demo03', playerName: 'IronWolf44', attemptScore: 731, reactionTimeMs: 269, result: 'success', playedAt: String(Date.now() - 520000) },
  ],
  moba_objective: [
    { attemptId: 'demo-m1', deviceId: 'esp32_demo01', playerName: 'SwiftDragon21', attemptScore: 1680, timingErrorHp: 32, difficulty: 'chaos', objectiveType: 'baron', result: 'success', playedAt: String(Date.now() - 880000) },
    { attemptId: 'demo-m2', deviceId: 'esp32_demo02', playerName: 'KeenHawk07', attemptScore: 1320, timingErrorHp: 88, difficulty: 'hard', objectiveType: 'dragon', result: 'success', playedAt: String(Date.now() - 1220000) },
  ],
};

function App() {
  const [view, setView] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('reflexlab-favorites');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to load favorites', error);
      return [];
    }
  });
  const [leaderboardMode, setLeaderboardMode] = useState('simple_reaction');
  const [leaderboards, setLeaderboards] = useState(firebaseReady ? {} : DEMO_LEADERBOARDS);
  const [deviceStats, setDeviceStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mobaDifficulty, setMobaDifficulty] = useState('all');

  useEffect(() => {
    localStorage.setItem('reflexlab-favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!database) return undefined;

    const unsubscribes = MODES.map(({ id: mode }) => {
      const leaderboardRef = ref(database, `leaderboards/${mode}`);
      return onValue(leaderboardRef, (snapshot) => {
        const data = snapshot.val();
        const entries = data
          ? Object.entries(data)
              .map(([attemptId, entry]) => ({ attemptId, ...entry }))
              .sort((a, b) => (b.attemptScore || 0) - (a.attemptScore || 0))
              .slice(0, 50)
          : [];
        setLeaderboards(prev => ({ ...prev, [mode]: entries }));
      }, (error) => {
        console.error('Failed to load leaderboard', error);
        setLoadError('Could not load leaderboard data from Firebase.');
      });
    });

    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }, []);

  useEffect(() => {
    if (!selectedDevice) {
      return undefined;
    }

    if (!database) return undefined;

    const deviceAttemptsRef = ref(database, `deviceAttempts/${selectedDevice}`);

    const unsubscribe = onValue(deviceAttemptsRef, async (snapshot) => {
      const attemptIds = snapshot.val();
      if (!attemptIds) {
        setDeviceStats({ attempts: [], playerName: null });
        setLoading(false);
        return;
      }

      try {
        const ids = Object.keys(attemptIds).slice(-60);
        const snapshots = await Promise.all(ids.map(id => get(ref(database, `attempts/${id}`))));
        const attempts = snapshots
          .map(item => item.val())
          .filter(Boolean)
          .sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0));

        setDeviceStats({
          attempts,
          playerName: attempts[0]?.playerName || null,
        });
      } catch (error) {
        console.error('Failed to load device attempts', error);
        setDeviceStats(null);
        setLoadError('Could not load this device. Check the Device ID or Firebase rules.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [selectedDevice]);

  const allEntries = useMemo(() => Object.values(leaderboards).flat(), [leaderboards]);
  const recentEntries = useMemo(() => (
    [...allEntries]
      .sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0))
      .slice(0, 6)
  ), [allEntries]);

  const visibleLeaderboard = useMemo(() => {
    const entries = leaderboards[leaderboardMode] || [];
    if (leaderboardMode !== 'moba_objective' || mobaDifficulty === 'all') return entries;
    return entries.filter(entry => entry.difficulty === mobaDifficulty);
  }, [leaderboards, leaderboardMode, mobaDifficulty]);

  const overview = useMemo(() => {
    const devices = new Set(allEntries.map(entry => entry.deviceId).filter(Boolean));
    const success = allEntries.filter(entry => entry.result === 'success').length;
    const bestReaction = allEntries
      .filter(entry => entry.reactionTimeMs)
      .reduce((best, entry) => Math.min(best, entry.reactionTimeMs), Infinity);
    const bestMoba = allEntries
      .filter(entry => entry.timingErrorHp !== undefined)
      .reduce((best, entry) => Math.min(best, entry.timingErrorHp), Infinity);

    return {
      attempts: allEntries.length,
      devices: devices.size,
      successRate: allEntries.length ? `${Math.round((success / allEntries.length) * 100)}%` : '-',
      bestReaction: Number.isFinite(bestReaction) ? `${bestReaction} ms` : '-',
      bestMoba: Number.isFinite(bestMoba) ? `${bestMoba} HP` : '-',
    };
  }, [allEntries]);

  const handleSearch = () => {
    const nextDevice = searchQuery.trim();
    if (!nextDevice) return;
    selectDevice(nextDevice);
  };

  const toggleFavorite = (deviceId) => {
    setFavorites(prev =>
      prev.includes(deviceId)
        ? prev.filter(id => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const selectDevice = (deviceId) => {
    setSelectedDevice(deviceId);
    if (!database) {
      setLoading(false);
      setLoadError('');
      const demoAttempts = Object.values(DEMO_LEADERBOARDS)
        .flat()
        .filter(attempt => attempt.deviceId === deviceId)
        .sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0));
      setDeviceStats({
        attempts: demoAttempts,
        playerName: demoAttempts[0]?.playerName || null,
      });
    } else {
      setLoading(true);
      setLoadError('');
      setDeviceStats(null);
    }
    setSearchQuery(deviceId);
    setView('device');
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    const n = Number(timestamp);
    if (n > 0 && n < 1000000000000) {
      const seconds = Math.floor(n / 1000);
      return `boot +${Math.floor(seconds / 60)}m`;
    }

    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return String(timestamp).slice(0, 10);
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  };

  const getModeLabel = (modeId) => MODES.find(mode => mode.id === modeId)?.short || 'Run';

  const getMetric = (attempt) => {
    if (attempt.reactionTimeMs) return `${attempt.reactionTimeMs} ms`;
    if (attempt.timingErrorHp !== undefined) return `${attempt.timingErrorHp} HP`;
    return '-';
  };

  const getBestMetric = (attempts, mode) => {
    const modeAttempts = attempts.filter(a => a.mode === mode && a.result === 'success');
    if (modeAttempts.length === 0) return '-';

    if (mode === 'moba_objective') {
      const best = modeAttempts.reduce((min, a) =>
        a.timingErrorHp < min.timingErrorHp ? a : min
      );
      return `${best.timingErrorHp} HP`;
    }

    const best = modeAttempts.reduce((min, a) =>
      a.reactionTimeMs < min.reactionTimeMs ? a : min
    );
    return `${best.reactionTimeMs} ms`;
  };

  const getSuccessRate = (attempts) => {
    if (!attempts.length) return '-';
    const success = attempts.filter(a => a.result === 'success').length;
    return `${Math.round((success / attempts.length) * 100)}%`;
  };

  const deviceName = deviceStats?.playerName || selectedDevice;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">RL</div>
          <div>
            <h1>ReflexLab</h1>
            <p>{firebaseReady ? 'Live Firebase' : 'Demo mode'}</p>
          </div>
        </div>

        <nav className="nav">
          <button className={`nav-button ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
            Dashboard
          </button>
          <button className={`nav-button ${view === 'leaderboard' ? 'active' : ''}`} onClick={() => setView('leaderboard')}>
            Leaderboard
          </button>
        </nav>

        <div className="sidebar-panel">
          <span className="panel-label">Device Search</span>
          <div className="search-box">
            <input
              type="text"
              className="search-input"
              placeholder="esp32_..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
            />
            <button className="search-button" onClick={handleSearch} disabled={!searchQuery.trim()}>
              Open
            </button>
          </div>
        </div>

        <div className="sidebar-panel">
          <span className="panel-label">Favorites</span>
          {favorites.length > 0 ? (
            <div className="favorites-list">
              {favorites.map(deviceId => (
                <button key={deviceId} className="favorite-chip" onClick={() => selectDevice(deviceId)}>
                  <span>{deviceId}</span>
                  <span className="chip-x" onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(deviceId);
                  }}>
                    x
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-compact">Save a device to keep it one tap away.</div>
          )}
        </div>
      </aside>

      <main className="main">
        {!firebaseReady && (
          <div className="notice">
            Firebase environment variables are missing, so the dashboard is showing demo data.
          </div>
        )}
        {loadError && <div className="notice danger">{loadError}</div>}

        {view === 'home' && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">Operations dashboard</span>
                <h2>Device performance at a glance</h2>
              </div>
              <button className="secondary-action" onClick={() => setView('leaderboard')}>
                View Leaderboard
              </button>
            </section>

            <section className="stat-strip">
              <MetricCard label="Attempts" value={overview.attempts} />
              <MetricCard label="Active Devices" value={overview.devices} />
              <MetricCard label="Success Rate" value={overview.successRate} />
              <MetricCard label="Best Reaction" value={overview.bestReaction} tone="green" />
              <MetricCard label="Best MOBA Error" value={overview.bestMoba} tone="amber" />
            </section>

            <section className="dashboard-grid">
              <div className="section-block">
                <div className="section-title">
                  <h3>Top Runs</h3>
                  <span>{visibleLeaderboard.length || allEntries.length} loaded</span>
                </div>
                <div className="compact-list">
                  {[...allEntries]
                    .sort((a, b) => (b.attemptScore || 0) - (a.attemptScore || 0))
                    .slice(0, 6)
                    .map((entry, index) => (
                      <RunRow key={entry.attemptId} entry={entry} index={index} onSelect={selectDevice} formatTime={formatTime} getMetric={getMetric} getModeLabel={getModeLabel} />
                    ))}
                  {allEntries.length === 0 && <EmptyState title="No attempts yet" text="Play a run on the ESP32 and the results will appear here." />}
                </div>
              </div>

              <div className="section-block">
                <div className="section-title">
                  <h3>Recent Activity</h3>
                  <span>latest uploads</span>
                </div>
                <div className="compact-list">
                  {recentEntries.map((entry, index) => (
                    <RunRow key={entry.attemptId} entry={entry} index={index} onSelect={selectDevice} formatTime={formatTime} getMetric={getMetric} getModeLabel={getModeLabel} compact />
                  ))}
                  {recentEntries.length === 0 && <EmptyState title="Waiting for data" text="Recent uploads will show up in this panel." />}
                </div>
              </div>
            </section>
          </>
        )}

        {view === 'leaderboard' && (
          <section className="leaderboard-section">
            <div className="page-heading">
              <div>
                <span className="eyebrow">Ranked by score</span>
                <h2>Leaderboards</h2>
              </div>
            </div>

            <div className="segmented">
              {MODES.map(mode => (
                <button
                  key={mode.id}
                  className={`segment ${leaderboardMode === mode.id ? 'active' : ''}`}
                  onClick={() => setLeaderboardMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {leaderboardMode === 'moba_objective' && (
              <div className="filter-bar" aria-label="MOBA difficulty filter">
                {DIFFICULTIES.map(difficulty => (
                  <button
                    key={difficulty}
                    className={`filter-chip ${mobaDifficulty === difficulty ? 'active' : ''}`}
                    onClick={() => setMobaDifficulty(difficulty)}
                  >
                    {difficulty === 'all' ? 'All' : difficulty}
                  </button>
                ))}
              </div>
            )}

            <div className="data-table">
              <div className="table-row table-header">
                <div>Rank</div>
                <div>Player</div>
                <div>Score</div>
                <div>Metric</div>
                <div>Date</div>
              </div>

              {visibleLeaderboard.map((entry, index) => (
                <RunRow key={entry.attemptId} entry={entry} index={index} onSelect={selectDevice} formatTime={formatTime} getMetric={getMetric} getModeLabel={getModeLabel} table />
              ))}

              {visibleLeaderboard.length === 0 && <EmptyState title="No attempts recorded" text="Try a different mode or difficulty filter." />}
            </div>
          </section>
        )}

        {view === 'device' && selectedDevice && (
          <section className="device-stats">
            <div className="device-header">
              <div>
                <span className="eyebrow">Device detail</span>
                <h2>{deviceName}</h2>
                <p>{selectedDevice}</p>
              </div>
              <button
                className={`favorite-button ${favorites.includes(selectedDevice) ? 'favorited' : ''}`}
                onClick={() => toggleFavorite(selectedDevice)}
              >
                {favorites.includes(selectedDevice) ? 'Saved' : 'Save Device'}
              </button>
            </div>

            {loading && <div className="loading">Loading device stats...</div>}

            {!loading && deviceStats && (
              <>
                <section className="stat-strip">
                  <MetricCard label="Best Reaction" value={getBestMetric(deviceStats.attempts, 'simple_reaction')} tone="green" />
                  <MetricCard label="Best Quick Draw" value={getBestMetric(deviceStats.attempts, 'quick_draw')} tone="blue" />
                  <MetricCard label="Best MOBA" value={getBestMetric(deviceStats.attempts, 'moba_objective')} tone="amber" />
                  <MetricCard label="Attempts" value={deviceStats.attempts.length} />
                  <MetricCard label="Success Rate" value={getSuccessRate(deviceStats.attempts)} />
                </section>

                <div className="section-block">
                  <div className="section-title">
                    <h3>Attempt History</h3>
                    <span>{deviceStats.attempts.length} stored</span>
                  </div>
                  <div className="history-list">
                    {deviceStats.attempts.slice(0, 30).map((attempt, index) => (
                      <RunRow key={attempt.attemptId} entry={attempt} index={index} onSelect={selectDevice} formatTime={formatTime} getMetric={getMetric} getModeLabel={getModeLabel} history />
                    ))}
                    {deviceStats.attempts.length === 0 && <EmptyState title="No attempts found" text="This Device ID exists in the app view, but no attempt rows were found." />}
                  </div>
                </div>
              </>
            )}

            {!loading && !deviceStats && <EmptyState title="Device not found" text="Check the Device ID and try again." />}
          </section>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunRow({ entry, index, onSelect, formatTime, getMetric, getModeLabel, table = false, history = false, compact = false }) {
  const className = table ? 'table-row run-row' : `run-row ${history ? 'history' : ''} ${compact ? 'compact' : ''}`;
  return (
    <button className={className} onClick={() => onSelect(entry.deviceId)}>
      <div className="rank-cell">#{index + 1}</div>
      <div className="player-cell">
        <strong>{entry.playerName || entry.deviceId}</strong>
        <span>{entry.deviceId}</span>
      </div>
      <div className="score-cell">{entry.attemptScore ?? '-'}</div>
      <div className="metric-cell">
        <span>{getMetric(entry)}</span>
        <small>{getModeLabel(entry.mode)}{entry.difficulty ? ` / ${entry.difficulty}` : ''}</small>
      </div>
      <div className="time-cell">{formatTime(entry.playedAt)}</div>
    </button>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export default App;
