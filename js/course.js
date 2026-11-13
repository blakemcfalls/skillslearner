import u01 from './lessons/u01-motion.js';
import u02 from './lessons/u02-vectors-energy.js';
import u03 from './lessons/u03-chance.js';
import u04 from './lessons/u04-feedback.js';
import u05 from './lessons/u05-optimize.js';
import u06 from './lessons/u06-waves.js';
import u07 from './lessons/u07-sensing.js';
import u08 from './lessons/u08-spectrum.js';
import u09 from './lessons/u09-heat-flow.js';
import u10 from './lessons/u10-fast-hot.js';
import u11 from './lessons/u11-space.js';
import u12 from './lessons/u12-autonomy.js';
import u13 from './lessons/u13-secure.js';
import u14 from './lessons/u14-integration.js';

export const TRACKS = { foundation: 'Foundation', core: 'Core engineering', integration: 'Integration' };

const F = 'foundation', C = 'core', I = 'integration';
export const SKILLS = {
  calc: { name: 'Calculus', track: F }, linalg: { name: 'Linear algebra', track: F },
  ode: { name: 'Differential equations', track: F }, prob: { name: 'Probability and statistics', track: F },
  fourier: { name: 'Fourier analysis', track: F }, nummeth: { name: 'Numerical methods', track: F },
  opt: { name: 'Optimization', track: F }, mech: { name: 'Classical mechanics', track: F },
  em: { name: 'Electromagnetics and waves', track: F }, thermo: { name: 'Thermodynamics and fluids', track: F },
  python: { name: 'Python', track: F }, rust: { name: 'Rust', track: F }, vcs: { name: 'Version control and testing', track: F },

  control: { name: 'Control theory', track: C }, kalman: { name: 'Kalman filtering and sensor fusion', track: C },
  trajopt: { name: 'Trajectory optimization', track: C }, radar: { name: 'Radar fundamentals', track: C },
  rf: { name: 'RF and antenna design', track: C }, eoir: { name: 'EO/IR sensing', track: C },
  dsp: { name: 'Digital signal processing', track: C }, detect: { name: 'Detection theory', track: C },
  prop: { name: 'Rocket and jet propulsion', track: C }, aero: { name: 'Compressible flow and aerodynamics', track: C },
  hyper: { name: 'Hypersonics', track: C }, orbit: { name: 'Orbital mechanics', track: C },
  tps: { name: 'Thermal protection systems', track: C }, composites: { name: 'Composites and high-temperature alloys', track: C },
  ceramics: { name: 'Ceramics', track: C }, am: { name: 'Additive manufacturing', track: C },
  energetics: { name: 'Energetic materials', track: C }, ew: { name: 'Electronic warfare', track: C },
  comms: { name: 'Secure communications', track: C }, gnss: { name: 'GNSS denial and spoofing', track: C },
  ml: { name: 'Machine learning', track: C }, cv: { name: 'Computer vision', track: C },
  rl: { name: 'Reinforcement learning', track: C }, swarm: { name: 'Multi-agent systems and swarms', track: C },
  sat: { name: 'Satellite systems', track: C }, sda: { name: 'Space domain awareness', track: C },
  embsec: { name: 'Embedded and systems security', track: C }, crypto: { name: 'Cryptography', track: C },

  syseng: { name: 'Systems engineering', track: I }, req: { name: 'Requirements and interface management', track: I },
  modsim: { name: 'Modeling and simulation', track: I }, mc: { name: 'Monte Carlo methods', track: I },
  vv: { name: 'Verification and validation', track: I }, dfm: { name: 'Design for manufacturing', track: I },
  cost: { name: 'Cost-exchange analysis', track: I }, acq: { name: 'Defense acquisition', track: I },
  arms: { name: 'Arms control', track: I }, export: { name: 'Export controls', track: I },
};

export const UNITS = [u01, u02, u03, u04, u05, u06, u07, u08, u09, u10, u11, u12, u13, u14].filter(u => u.lessons.length);
export const LESSONS = [];
export const byId = {};
UNITS.forEach(u => u.lessons.forEach(l => {
  l.unit = u; l.index = LESSONS.length; l.cards = l.cards || []; l.quiz = l.quiz || [];
  LESSONS.push(l); byId[l.id] = l;
}));

export const cardIds = l => [...l.cards.map((_, i) => `${l.id}:c${i}`), ...l.quiz.map((_, i) => `${l.id}:q${i}`)];

export function findCard(cardId) {
  const [lid, tag] = cardId.split(':');
  const lesson = byId[lid];
  if (!lesson || !tag) return {};
  const i = +tag.slice(1);
  if (tag[0] === 'c' && lesson.cards[i]) return { lesson, kind: 'recall', data: lesson.cards[i] };
  if (tag[0] === 'q' && lesson.quiz[i]) return { lesson, kind: lesson.quiz[i].choices ? 'mc' : 'num', data: lesson.quiz[i] };
  return {};
}
