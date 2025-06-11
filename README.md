# FAST: Fast Autonomous & Safe Transport

<p align="center">
    <img src="https://github.com/user-attachments/assets/9a3fcfd8-4468-4881-af18-5aed3deb1829" style="display:block;float:none;margin-left:auto;margin-right:auto;width:10%"/>
</p>

Group project for the course of Autonomous Software Agents at University of Trento (2025).

Authors: [**Giovanni Valer**](https://github.com/jo-valer) and [**Daniele Della Pietra**](https://github.com/dellastone).

## Project Structure

```
FAST
├── 1_single_agent
│   ├── BeliefRevision.js     # Belief revision and sensing logic
│   ├── config.js             # Client configuration (host, token)
│   ├── fast_utils.js         # Utility functions (distance, map stats, etc.)
│   ├── FASTconfig.js         # Configuration parameters for the agent behavior
│   ├── main.js               # Entry point: agent setup and main loop
│   ├── Planner.js            # Intention and plan classes
│   └── search_deamon.js      # Pathfinding daemon (A*)
├── 2_team
│   ├── BeliefRevision.js
│   ├── domain-grid.pddl
│   ├── domain-navigation-patrol.pddl
│   ├── config.js
│   ├── fast_utils.js
│   ├── FASTconfig.js
│   ├── main.js               # Individual Agent setup and main loop
│   ├── Planner.js
│   ├── search_deamon.js
│   └── start.js              # Entry point for team scenario
├── dashboard
│   ├── data
│   │   ├── actions.js
│   │   ├── fields.js
│   │   └── positions.js
│   ├── dashboard_main.js
│   ├── dashboard.js
│   ├── multi_dashboard.html
│   ├── riders.js
│   └── server.js
├── package.json
├── package-lock.json
└── README.md
```

## Getting Started

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/jo-valer/fast-agent.git
   cd fast-agent
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. If you want, you can change the client configuration in `1_single_agent/config.js` and `2_team/config.js` (host and token).

### Running in Single-Agent Scenario
```bash
cd 1_single_agent
node main.js
```

### Running in Team Scenario
```bash
cd 2_team
node start.js
```

You can choose to run the team scenario with **PDDL**. To do so, you need to set `PDDL` to `true` in `2_team/FASTconfig.js`. This will enable the PDDL planner for team coordination.
