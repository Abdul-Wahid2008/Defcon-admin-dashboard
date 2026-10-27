/**
 * Local stand-in for the club's scoreboard.json. PROVISIONAL shape (see src/lib/server/health/scoreboard-source.ts).
 * Run: npx tsx scripts/fake-scoreboard.ts   (PORT=3200 TEAMS=24 ROUND_SEC=10)
 * Serves /data/scoreboard.json with a round that advances every ROUND_SEC seconds.
 * Override a verdict:  GET /control?team=3&service=docuvault&flagstore=flag1&verdict=MUMBLE   (verdict=clear removes it)
 * Freeze the round:    GET /control?freeze=1  (freeze=0 resumes)
 */
import http from 'node:http';
import { getEventConfig } from '../src/lib/event-config';

const PORT = Number(process.env.PORT || 3200);
const TEAMS = Number(process.env.TEAMS || 24);
const ROUND_MS = Number(process.env.ROUND_SEC || 10) * 1000;
const start = Date.now();
let frozenRound: number | null = null;
const overrides = new Map<string, string>();
const services = getEventConfig().services.map(s => s.key);

const currentRound = () => frozenRound ?? Math.floor((Date.now() - start) / ROUND_MS) + 1;

function board() {
  return {
    currentRound: currentRound(),
    teams: Array.from({ length: TEAMS }, (_, i) => ({
      teamId: String(i + 1),
      services: services.map(key => ({
        key,
        flagstores: ['flag0', 'flag1', 'flag2'].map(fs => ({
          key: fs,
          verdict: overrides.get(`${i + 1}:${key}:${fs}`) ?? 'OK',
        })),
      })),
    })),
  };
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/data/scoreboard.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(board()));
  } else if (url.pathname === '/control') {
    const q = url.searchParams;
    if (q.has('freeze')) frozenRound = q.get('freeze') === '1' ? currentRound() : null;
    const [team, service, fs, verdict] = ['team', 'service', 'flagstore', 'verdict'].map(k => q.get(k));
    if (team && service && fs && verdict) {
      const key = `${team}:${service}:${fs}`;
      if (verdict === 'clear') overrides.delete(key); else overrides.set(key, verdict);
    }
    res.writeHead(200).end('ok');
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fake scoreboard on http://127.0.0.1:${PORT}/data/scoreboard.json`));
