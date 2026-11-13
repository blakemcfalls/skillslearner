# Fieldwork

A daily, hands-on course in defense technology and engineering. 129 lessons across 51 skills, from calculus to export controls. Every lesson has an interactive lab you control, a mission to hit in that lab, and questions that come back on a spaced-repetition schedule.

It is a static website with no build step and no dependencies. Progress is saved in your browser.

## A daily session (20 to 30 minutes)

1. **Recall.** Cards from earlier lessons that are due today. You answer before seeing the answer; cards you know come back later (1 day, 3 days, about a week, then longer), cards you miss come back tomorrow.
2. **Learn.** One new lesson. It opens with two retrieval questions from its prerequisite lessons, then a short explanation with the one or two equations that matter.
3. **Do.** The lab. Sliders, draggable points and live readouts, with a mission such as "tune the PID gains until overshoot is under 10%".
4. **Check.** Two or three questions, and in 20 lessons a Python exercise that runs in the page and is checked automatically.

The lessons are interleaved: each unit mixes math, physics, code and an application, so an idea is used within days of being learned.

| Unit | Title | Lessons | Skills covered |
|---|---|---|---|
| 1 | Motion | 9 | Calculus, Classical mechanics, Python, Differential equations, Numerical methods, Version control and testing |
| 2 | Vectors and energy | 9 | Linear algebra, Classical mechanics, Rocket and jet propulsion, Calculus, Numerical methods, Python, Version control and testing |
| 3 | Chance and estimation | 9 | Probability and statistics, Monte Carlo methods, Linear algebra, Detection theory, Kalman filtering and sensor fusion, Rust |
| 4 | Feedback | 9 | Differential equations, Linear algebra, Control theory, Classical mechanics, Kalman filtering and sensor fusion, Rust |
| 5 | Many variables | 9 | Calculus, Optimization, Trajectory optimization, Numerical methods |
| 6 | Waves and signals | 10 | Fourier analysis, Electromagnetics and waves, Digital signal processing |
| 7 | Sensing | 9 | Radar fundamentals, RF and antenna design, Detection theory, EO/IR sensing, Kalman filtering and sensor fusion |
| 8 | The spectrum contest | 7 | Secure communications, Electronic warfare, GNSS denial and spoofing, Python |
| 9 | Heat and flow | 9 | Thermodynamics and fluids, Compressible flow and aerodynamics, Rocket and jet propulsion |
| 10 | Fast and hot | 12 | Hypersonics, Thermal protection systems, Composites and high-temperature alloys, Ceramics, Additive manufacturing, Energetic materials, Design for manufacturing |
| 11 | Space | 7 | Orbital mechanics, Satellite systems, Space domain awareness |
| 12 | Autonomy | 9 | Machine learning, Computer vision, Reinforcement learning, Multi-agent systems and swarms |
| 13 | Secure systems | 7 | Rust, Embedded and systems security, Cryptography |
| 14 | Integration | 14 | Systems engineering, Requirements and interface management, Modeling and simulation, Monte Carlo methods, Verification and validation, Cost-exchange analysis, Defense acquisition, Arms control, Export controls |

## Run it

Any static file server works, because the app uses JavaScript modules:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Put it online with GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the checks and deploys the site whenever `main` changes.

1. Merge this branch into `main`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. After the workflow finishes, the site is at `https://<your-username>.github.io/skillslearner/`.

GitHub Pages sites are public. Use one address consistently: progress is stored per browser and per address. **Progress → Download progress file** moves it between devices.

## Python in the browser

Code exercises run real Python (with NumPy) through [Pyodide](https://pyodide.org), loaded from the jsDelivr CDN the first time you run code, about 10 MB. That first run needs an internet connection. Code runs in a background worker and is stopped after 15 seconds, so an accidental infinite loop cannot freeze the page.

Rust is taught through step-through traces and read-predict-fix questions; it is not executed.

## Checks

```bash
npm test
```

This runs two things:

- `tools/validate.mjs` loads every lesson and checks its structure, runs every simulation headlessly at its default, minimum and maximum settings looking for errors or non-finite drawing, confirms each mission is unsolved at the start and solved by its recorded solution, and runs each Python exercise's reference solution against its tests with your local `python3` and NumPy (and confirms the starter code does not already pass).
- `tools/store.test.mjs` tests the review scheduler.

## How it is built

```
index.html            page shell
css/app.css           styles, light and dark
js/app.js             views: Today, Course, Lesson, Review, Lab, Progress
js/sim.js             the simulation engine and drawing helpers
js/store.js           progress storage and the spaced-repetition scheduler
js/py.js              in-browser Python runner
js/course.js          skill list and unit order
js/lessons/u01…u14    lesson content, one file per unit
tools/                validator and tests
```

A lesson is a plain object:

```js
{
  id: 'mech-spring', skill: 'mech', title: 'Spring force and simple harmonic motion',
  pre: ['mech-kinematics'],              // warm-up questions are drawn from these
  hook: 'Why it matters, in a sentence.',
  body: ['Paragraph with $F = -kx$ math.', { eq: 'T = 2π·√(m/k)' }],
  sim: {
    controls: [{ k: 'k', label: 'Stiffness', min: 10, max: 200, step: 1, v: 40 }],
    init: p => ({ x: 0.8, v: 0 }),       // state
    step(s, p, dt) { /* advance */ },     // optional: makes it animate
    draw(g, s, p) { /* g.view, g.axes, g.fn, g.arrow, g.spring … */ },
    read: (s, p) => [['period', '0.99 s']],
    mission: 'Text of the goal.', goal: (s, p) => true, win: { k: 79 },
  },
  cards: [{ q: 'Free-recall prompt', a: 'Answer' }],
  quiz: [{ q: 'Question', choices: ['A', 'B', 'C'], answer: 1, why: 'Explanation' },
         { q: 'Numeric question', num: 6.37, unit: 'Hz', why: 'Working' }],
}
```

Add a lesson to a unit file and run `npm test`; the validator will tell you if the lab throws, if the mission cannot be solved, or if a prerequisite points forward.

## Scope and limits

- This is a study course built from public, textbook-level material. The models in the labs are simplified to teach the principle; several (thermal protection sizing, acquisition cost growth, defect economics) are deliberately stylized and say so. They are not design tools.
- Lessons on energetic materials, electronic warfare and security explain physics and defensive principles. They contain no formulations, procedures or attack tooling.
- The export-controls and acquisition lessons describe the United States system in outline and are not legal advice.
