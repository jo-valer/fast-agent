import { ActionType } from "../dashboard/data/action.js";
import { Heatmap, shareParcelWithBuddy } from "./BeliefRevision.js"
import { findNearestDelivery, manhattanDistance } from "./fast_utils.js";
import { DELIVERY_TILE_SEARCH_FUNCTION, USE_PDDL } from "./FASTconfig.js";
import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { onlineSolver } from "@unitn-asa/pddl-client";

/**
 * @typedef {import(
 *   "@unitn-asa/deliveroo-js-client/types/ioTypedSocket.cjs"
 * ).parcel} parcel
 */

// ----- Base Classes for Intentions and Plans -----

/**
 * Represents a high-level goal (intention) the agent attempts to achieve.
 */
export class Intention {
    /**
     * @param {object} agent - The agent pursuing this intention
     * @param {Array} predicate - Array describing the desired action and parameters
     * @param {Array} reachableSpawn - Known reachable pickup tiles
     * @param {Array} reachableDelivery - Known reachable delivery tiles
     */
    constructor(agent, predicate, reachableSpawn, reachableDelivery) {
        this.agent = agent;                    // Reference to the agent instance
        this.predicate = predicate;            // Action name and arguments, e.g. ["go_pick_up", x, y]
        this.currentPlan = null;               // The concrete Plan being executed
        this.stopped = false;                  // Flag for whether this intention has been stopped
        this.reachableSpawn = reachableSpawn;  // Cached reachable spawn locations
        this.reachableDelivery = reachableDelivery; // Cached reachable delivery locations
    }

    /** Helper to log via agent's logger or console */
    log(...args) {
        if (this.agent?.log) this.agent.log(...args);
        else console.log(...args);
    }

    /**
     * Stop this intention and cancel its current plan
     */
    stop() {
        this.stopped = true;
        this.currentPlan?.stop();
    }

    /**
     * Try to achieve the intention by finding an applicable Plan.
     * Loops through known planLibrary, selects the first that matches.
     * @returns {Promise<boolean>} Resolves true on success, rejects on failure.
     */
    async achieve() {
        if (this.stopped) throw new Error("Intention stopped");
        // Iterate through all Plan classes in planLibrary
        for (const PlanClass of planLibrary) {
            if (this.stopped) break;
            // Check if this Plan can handle the requested action
            if (PlanClass.isApplicable(...this.predicate)) {
                // Instantiate and execute plan
                this.currentPlan = new PlanClass(this.agent, this.reachableSpawn, this.reachableDelivery);
                try {
                    return await this.currentPlan.execute(...this.predicate);
                } catch (error) {
                    // Plan failed; can log for debugging and continue to next
                    // this.log("Plan failed:", PlanClass.name, this.predicate, error);
                }
            }
        }
        if (this.stopped) throw new Error("Intention stopped");
        // No plan matched the intention
        throw new Error("No plan for: " + this.predicate.join(" "));
    }
}

/**
 * Abstract base class for all executable plans.
 */
export class Plan {
    constructor(agent, reachableSpawn, reachableDelivery) {
        this.agent = agent;                    // The agent executing this plan
        this.stopped = false;                  // Flag to stop this plan
        this.subIntentions = [];               // Any sub-intentions spawned
        this.reachableSpawn = reachableSpawn;  // Cached spawn tiles
        this.reachableDelivery = reachableDelivery; // Cached delivery tiles
    }

    log(...args) {
        if (this.agent?.log) this.agent.log(...args);
        else console.log(...args);
    }

    /**
     * Returns a free move action based on current position and agents
     * @param {number} x - Current x-coordinate
     * @param {number} y - Current y-coordinate
     * @param {Map<string, object>} agents - Map of all agents
     * @return {string} - Free move action ('up', 'down', 'left', 'right')
     * */
    getFreeMove(x, y, agents) {
        // Check all four directions for free move
        const directions = [
            { action: 'up', dx: 0, dy: 1 },
            { action: 'down', dx: 0, dy: -1 },
            { action: 'left', dx: -1, dy: 0 },
            { action: 'right', dx: 1, dy: 0 }
        ];
        for (const { action, dx, dy } of directions) {
            const newX = x + dx;
            const newY = y + dy;
            // Check if the new position is occupied by any agent 
            const occupied = Array.from(agents.values()).some(a => a.x === newX && a.y === newY);

            //check the map tile type, if different from 0, then it is free
            const tile = this.agent.myIslandMap.getTile(newX, newY);
            if (!occupied && tile?.type != 0) {
                return action; // Return the first free move found
            }

        }
        return 'stay'; // No free move found
    }
    /**
     * Stop this plan and all its sub-intentions
     */
    stop() {
        this.stopped = true;
        this.subIntentions.forEach(si => si.stop());
    }

    /**
     * Delegate a subgoal back to Intention framework
     * @param {Array} predicate - action array for sub-intention
     */
    async subIntention(predicate) {
        const intent = new Intention(this.agent, predicate, this.reachableSpawn, this.reachableDelivery);
        this.subIntentions.push(intent);
        return intent.achieve();
    }
}

// ----- Concrete Plans -----

/**
 * Plan: navigate to a parcel and pick it up
 */
export class GoPickUp extends Plan {
    /** Check if this plan can handle "go_pick_up" actions */
    static isApplicable(action) { return action === "go_pick_up"; }

    /**
     * @param {string} _ - placeholder for action name
     * @param {number} x - x-coordinate of parcel
     * @param {number} y - y-coordinate of parcel
     */
    async execute(_, x, y,id) {
        if (this.stopped) throw new Error("stopped");
        await this.agent.client.emitSay(this.agent.buddyId, {
                type: "lock_parcel",
                parcel: id
        });
        // First achieve movement to the parcel location
        const reached = await this.subIntention(["go_to", x, y]);
        await this.agent.client.emitSay(this.agent.buddyId, {
                type: "unlock_parcel",
                parcel: id
        });
        if (!reached) throw new Error("Cannot reach pickup location");

        if (this.stopped) throw new Error("stopped");
        // Emit pickup command to server
        if (!await this.agent.client.emitPickup()) throw new Error("Pickup failed");
   
        // Notify sensing system of pickup event
        this.agent.sensingEmitter.emit("parcel_pickup");
        return true;
    }
}

/**
 * Plan: deliver carried parcels to nearest available delivery tile
 */
export class GoDeliver extends Plan {
    static isApplicable(action) { return action === "go_deliver"; }

    async execute(_) {
        // Ensure we have something to deliver
        if (this.agent.me.carrying.size === 0)
            throw new Error("Nothing to deliver");

        // Filter delivery tiles to those without agents on them (not considering buddy) use agents list and their positions
        const freeDelivery = this.reachableDelivery.filter(tile => {
            const tileAgents = Array.from(this.agent.agents.values()).filter(a => a.x === tile.x && a.y === tile.y && a.id !== this.agent.buddyId);
            return tileAgents.length === 0;
        });

        if (freeDelivery.length === 0) {
            console.warn("No free delivery tiles available");
            throw new Error("No free delivery tiles");
        }
        
        let fn = DELIVERY_TILE_SEARCH_FUNCTION;
        if (fn === "auto") {
            // Automatically select search function based on the number of delivery tiles
            fn = freeDelivery.length > 15 ? "manhattan" : "searchFunction";
        }
        if (fn === "manhattan") {
            // Sort by Manhattan distance from agent
            freeDelivery.sort((a, b) =>
                manhattanDistance(this.agent.me.x, this.agent.me.y, a.x, a.y) -
                manhattanDistance(this.agent.me.x, this.agent.me.y, b.x, b.y)
            );
        } else if (fn === "searchFunction") {
            // Sort by A* search distance from agent
            freeDelivery.sort((a, b) => 
                this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: a.x, y: a.y }).length -
                this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: b.x, y: b.y }).length
            );
        }

        const dest = freeDelivery[0];
        // Move to chosen delivery tile
        const reached = await this.subIntention(["go_to", dest.x, dest.y]);
        if (!reached) throw new Error("Cannot reach delivery location");

        await this.agent.client.emitPutdown();

        // Notify sensing system of delivery event
        this.agent.sensingEmitter.emit("parcel_delivery");
        return true;
    }
}

/**
 * Plan: patrol spawn tiles to look for new parcels
 */
export class Patrolling extends Plan {
    static isApplicable(action) { return action === "patrolling"; }

    /**
     * @param {string} _ - placeholder action name
     * @param {boolean} easyPatrol - if only one tile, simpler behavior
     */
    async execute(_, easyPatrol) {
        if (this.stopped) throw new Error("stopped");

        // If only one spawn tile, optionally just stay
        if (easyPatrol) {
            const path = this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: this.reachableSpawn[0].x, y: this.reachableSpawn[0].y }, this.agent.agents);
            let easyX = this.reachableSpawn[0].x;
            let easyY = this.reachableSpawn[0].y;
            let deliveryTile = this.reachableDelivery? this.reachableDelivery[0] : null;
            if (!path) {
                // If no path found set the easyX and easyY to the half way point between span tile and delivery tile
                if (deliveryTile) {
                    easyX = Math.round((easyX + deliveryTile.x) / 2);
                    easyY = Math.round((easyY + deliveryTile.y) / 2);
                } else {
                    easyX = Math.round(easyX);
                    easyY = Math.round(easyY);
                }
            }
            if (this.agent.me.x === easyX && this.agent.me.y === easyY) {
                this.agent.sensingEmitter.emit("agent_stay");
                return true;
            }
            return await this.subIntention(["go_to", easyX, easyY]);
        }

        // If I am on a delivery tile, and mapStats.spawnArea==true, then just go to the nearest spawn tile
        if (this.agent.mapStats.spawnableArea) {
            if (this.agent.map.getTile(this.agent.me.x, this.agent.me.y)?.type === 2) {
                const nearestSpawn = this.reachableSpawn.reduce((prev, curr) => {
                    const prevDist = Math.abs(prev.x - this.agent.me.x) + Math.abs(prev.y - this.agent.me.y);
                    const currDist = Math.abs(curr.x - this.agent.me.x) + Math.abs(curr.y - this.agent.me.y);
                    return currDist < prevDist ? curr : prev;
                });
                return await this.subIntention(["go_to", nearestSpawn.x, nearestSpawn.y]);
            }
        }

        // Use heatmap to select next spawn tile for patrol
        const heatEntries = Array.from(this.agent.tilesHeatmap.getHeatmap().entries());
        if (!heatEntries.length) throw new Error("Heatmap has no spawn tiles!");

        // Only consider reachable spawn keys present in heatmap
        const reachableKeys = new Set(
            this.reachableSpawn.map(tile => `${tile.x}_${tile.y}`)
        );

        const filtered = heatEntries.filter(([key, _]) => reachableKeys.has(key));
        if (!filtered.length) throw new Error("No heatmap entries on your island!");

        // Score entries by heat value plus slight random for variation, then pick top-half
        const scored = filtered.map(([key, val]) => {
            const [tx, ty] = key.split("_").map(Number);
            return { x: tx, y: ty, score: val + Math.random() * 0.2 };
        }).sort((a, b) => b.score - a.score);

        // Randomly choose among top-half hottest spawn tiles
        const target = scored[Math.floor(Math.random() * (scored.length / 2))];
        return await this.subIntention(["go_to", target.x, target.y, "patrolling"]);
    }
}

function transformPlan(plan) {
    const result = [];

    plan.forEach((stepObj, index) => {
        const [, fromLoc, toLoc] = stepObj.args;
        const fromMatch = fromLoc.match(/^LOC_(\d+)_(\d+)$/);
        const toMatch   = toLoc.match(/^LOC_(\d+)_(\d+)$/);
        if (!fromMatch || !toMatch) return; // skip if format is unexpected

        const fx = Number(fromMatch[1]);
        const fy = Number(fromMatch[2]);
        const tx = Number(toMatch[1]);
        const ty = Number(toMatch[2]);

        let action;
        if      (tx === fx + 1 && ty === fy) action = 'right';
        else if (tx === fx - 1 && ty === fy) action = 'left';
        else if (ty === fy + 1 && tx === fx) action = 'up';
        else if (ty === fy - 1 && tx === fx) action = 'down';
        else action = 'stay';

        result.push({
            step: index + 1,
            action,
            current: { x: tx, y: ty }
        });
  });

  return result;
}


/**
 * Build a purely‐STRIPS PDDL problem that requires visiting exactly the spawn tiles in 'requiredSpawns'
 * (i.e. forcing (visited loc_x_y) for each), then reaching (gx,gy). No numeric fluents or metrics involved.
 *
 * @param {number} sx
 * @param {number} sy
 * @param {number} gx
 * @param {number} gy
 * @param {Array<{x:number,y:number}>} tilesArr
 * @param {Array<{x:number,y:number}>} reachableSpawn
 * @param {Array<{x:number,y:number}>} requiredSpawns
 * @returns {string}  a PDDL problem string
 */
function buildStripsProblem(sx, sy, gx, gy, tilesArr, reachableSpawn, requiredSpawns) {
    const locNames = tilesArr.map(t => `loc_${t.x}_${t.y}`).join(" ");
    const objects = `agent1 - agent\n${locNames} - location`;


    const adjFacts = [];
    for (const t of tilesArr) {
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = t.x + dx, ny = t.y + dy;
            if (tilesArr.some(u => u.x === nx && u.y === ny)) {
                adjFacts.push(`(adj loc_${t.x}_${t.y} loc_${nx}_${ny})`);
            }
        }
    }

    const spawnFacts = reachableSpawn
        .map(sp => `(spawn-loc loc_${sp.x}_${sp.y})`)
        .filter(fact => {
            const m = fact.match(/loc_(\d+)_(\d+)/);
            if (!m) return false;
            const x = Number(m[1]), y = Number(m[2]);
            return tilesArr.some(t => t.x === x && t.y === y);
        });

    const inits = [
        `(at agent1 loc_${sx}_${sy})`,
        ...adjFacts,
        ...spawnFacts
    ];

    const goalVisitedLines = requiredSpawns.map(sp => `(visited loc_${sp.x}_${sp.y})`);
    const goalLines = [`(at agent1 loc_${gx}_${gy})`, ...goalVisitedLines].join("\n      ");

    const problemPddl = `(define (problem patrol-rich)
                        (:domain grid-navigation-patrol)

                        (:objects
                        ${objects}
                        )

                        (:init
                        ${inits.join("\n    ")}
                        )

                        (:goal (and
                        ${goalLines}
                        ))
                        )`;

    return problemPddl;
}

/**
 * Try to find a plan that visits as many distinct spawn‐tiles as possible on the way to (gx,gy).
 * It does this by iterating k = max → 0, and testing every subset-of-size-k of reachableSpawn.
 *
 * @param {string|number}                id             - (unused for online solver, but kept for signature)
 * @param {number}                       sx
 * @param {number}                       sy
 * @param {number}                       gx
 * @param {number}                       gy
 * @param {Map<string, {x:number,y:number,type:number}>} tiles
 * @param {Array<{x:number,y:number}>}                   reachableSpawn
 * @param {Heatmap} tilesHeatmap
 * @param {Array}                           agents
 * @returns {Promise<Array<{action:string,args:string[]}> | null>}
 */
async function onlineSolverPatrol(id, sx, sy, gx, gy, tiles, reachableSpawn, tilesHeatmap, agents) {

    const agentArray = agents instanceof Map ? Array.from(agents.values()) : Array.isArray(agents) ? agents : [];
    const tilesArr = Array.from(tiles.values())
        .filter(t => {
        const occupied = agentArray.some(a => Math.round(a.x) === t.x && Math.round(a.y) === t.y);
        return t.type !== 0 && !occupied;
        })
        .map(t => ({ x: t.x, y: t.y }));


    const allSpawnTiles = reachableSpawn
        .filter(sp => tilesArr.some(t => t.x === sp.x && t.y === sp.y))
        .map(sp => ({ x: sp.x, y: sp.y }));

        const reachableKeys = new Set(
            reachableSpawn.map(tile => `${tile.x}_${tile.y}`)
        );

        const heatEntries = Array.from(tilesHeatmap.getHeatmap().entries());

        const filtered = heatEntries.filter(([key, _]) => reachableKeys.has(key));
        console.log(filtered)
        if (!filtered.length) throw new Error("No heatmap entries on your island!");

        const scored = filtered.map(([key, val]) => {
            const [tx, ty] = key.split("_").map(Number);
            return { x: tx, y: ty, score: val + Math.random() * 0.2 };
        }).sort((a, b) => b.score - a.score);

        const selectedSpawnTiles = scored.slice(0, Math.ceil(scored.length / 2))
            .map(t => ({ x: t.x, y: t.y }));


        const domainPddl = await readFile("./domain-navigation-patrol.pddl");
        const problemPddl = buildStripsProblem(sx, sy, gx, gy, tilesArr, allSpawnTiles, selectedSpawnTiles);

        let planStrings;
        try {
            planStrings = await onlineSolver(domainPddl, problemPddl);
        } catch (err) {
            planStrings = [];
        }

        if (planStrings && planStrings.length > 0) {
            let p = transformPlan(planStrings); // Parse into { step, action, current } format
            return p;
        }
    return null;
}

/**
 * Helper to read a file as UTF-8 text.
 * @param {string} filePath – Path to the file.
 * @returns {Promise<string>} – Resolves with the file’s contents.
 */
export async function readFile(filePath) {
    return fs.readFile(filePath, "utf8");
}

/**
 * Invoke a local PDDL solver (e.g. Fast Downward) and return the steps.
 * Uses bounding-box pruning, drops the `free` predicate, and runs greedy-FF search.
 *
 * @param {string|number} id   - Unique identifier for plan directory.
 * @param {number}    sx       - Agent's start X coordinate.
 * @param {number}    sy       - Agent's start Y coordinate.
 * @param {number}    gx       - Target X coordinate.
 * @param {number}    gy       - Target Y coordinate.
 * @param {Array<{x:number,y:number,type:number}>} tiles - All walkable tiles.
 * @returns {Promise<Array<{ action: string, args: string[] }>>}
 */
export async function localSolver(id, sx, sy, gx, gy, tiles, agents) {
    const fdScript =
        "C:\\Users\\danid\\Documents\\downward-release-24.06.1\\downward-release-24.06.1\\fast-downward.py";
    const python = 'python';

    const planDir = path.join('./pddl_plans', id.toString());
    await fs.mkdir(planDir, { recursive: true });
    const domainFile  = 'domain-grid.pddl';
    const problemFile = path.join(planDir, 'problem.pddl');
        

    const tilesArr = Array.from(tiles.values()).filter(t => {
        const occupied = Array.from(agents.values()).some(a => a.x === t.x && a.y === t.y);
        return t.type !== 0 && !occupied;
    }).map(t => ({ x: t.x, y: t.y }));

    const locNames = tilesArr.map(t => `loc_${t.x}_${t.y}`).join(' ');

    // Objects
    const objects = `agent1 - agent\n${locNames} - location`;

    // Init facts: only at/adj
    const inits = [
        `(at agent1 loc_${sx}_${sy})`,
        ...tilesArr.flatMap(t =>
        [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => {
            const n = tilesArr.find(u => u.x === t.x + dx && u.y === t.y + dy);
            return n
            ? `(adj loc_${t.x}_${t.y} loc_${n.x}_${n.y})`
            : null;
        })
        ).filter(Boolean)
    ];

    const problemPddl = `(define (problem goto)
        (:domain grid-navigation)
        (:objects
        ${objects}
        )
        (:init
        ${inits.join('\n  ')}
        )
        (:goal (at agent1 loc_${gx}_${gy}))
        )`;
    fs.writeFile(problemFile, problemPddl, 'utf8');

    const sasPath  = path.join(planDir, 'output.sas');
    const planPath = path.join(planDir, 'sas_plan');
    const args = [
        fdScript,
        '--sas-file', sasPath,
        '--plan-file', planPath,
        domainFile,
        problemFile,
        '--search', "let(hff, ff(), let(hcea, cea(), lazy_greedy([hff, hcea], preferred=[hff, hcea])))"

    ];


    await new Promise((resolve, reject) => {
        const proc = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('exit', code => {
        if (code === 0 || code === 12) {
            resolve();
        } else {

            reject(new Error(`Fast Downward failed with exit code ${code}`));
        }
        });
    });

    const planText = await fs.readFile(`${planPath}`, 'utf8');
    const steps = planText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.startsWith('('))
        .map(l => {
        const inside = l.replace(/^\(\s*(.*)\s*\)$/, '$1');
        const [action, ...args] = inside.split(/\s+/);
        return { action: action.toUpperCase(), args };
        });

    if (!steps.length) return null;
    return steps;
}

export async function calculatePathWithPDDL(sx, sy, tx, ty, tiles, agents) {


    const plan = await localSolver(
        this.agent.me.id,
        sx, sy,
        tx, ty,
        tiles,
        agents
    );

    if (!plan || !plan.length) return null;
    const path = [];
    for (const step of plan) {

        if (step.action !== "MOVE") continue;

        // args = [ agentName, fromLoc, toLoc ]
        const [_, from, to] = step.args;

        // from = "LOC_x_y", to = "LOC_x2_y2"
        const [ , fx, fy ] = from.split("_").map(Number);
        const [ , tx2, ty2 ] = to.split("_").map(Number);

        let action = "stay";
        if      (tx2 - fx ===  1) action = "right";
        else if (tx2 - fx === -1) action = "left";
        else if (ty2 - fy ===  1) action = "up";
        else if (ty2 - fy === -1) action = "down";

        path.push({ action, current:{ x: fx, y: fy } });
    }
    return path;
}
/**
 * Plan: navigate from current location to target coordinates using A* search
 */
export class SearchFunctionMove extends Plan {
    static isApplicable(action) { return action === "go_to"; }

    async _buddyDelivery(oppositeAction) {
        //if you are not carrying anything, return
        if (this.agent.me.carrying.size === 0) {
            return;

        }
        await this.agent.client.emitSay(this.agent.buddyId, {
            type: "stop",
            location: { x: Math.round(this.agent.me.x), y: Math.round(this.agent.me.y)}
        });
        for (const p of this.agent.me.carrying.values()) {
            this.agent.lockedParcels.set(p.id, { x: this.agent.me.x, y: this.agent.me.y });
        }
        await this.agent.client.emitPutdown()
        await this.agent.client.emitMove(oppositeAction);

        // Say to the buddy there is a new parcel (just one is enough to trigger replanning)
        const p = Array.from(this.agent.me.carrying.values())[0];
        await shareParcelWithBuddy(p, this.agent.client, this.agent.buddyId);
    }

    /**
     * @param {string} _ - placeholder action name
     * @param {number} tx - target x-coordinate
     * @param {number} ty - target y-coordinate
     */
    async execute(_, tx, ty, planName) {
        if (this.stopped) throw new Error("stopped");

        // If already at destination, emit stay move
        if (this.agent.me.x === tx && this.agent.me.y === ty) {
            const x = Math.round(this.agent.me.x);
            const y = Math.round(this.agent.me.y);
            for (const p of this.agent.parcels.values()) {
                if (p.x === x && p.y === y && !p.carriedBy) {
                    await this.agent.client.emitPickup();
                    break;
                }
            }
            
            this.agent.sensingEmitter.emit("agent_stay");
            return true;
        }
        const closeAgents = [] 
        // consider only agents that are close to me using the A* search
        for (const a of this.agent.agents.values()) {
            if ( a.id === this.agent.buddyId) continue;
            const path = this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: a.x, y: a.y });
            if (path?.length < 10 ) {
                closeAgents.push(a);
            }
        }
        let path = null;
        // Compute path via A* search over the map graph
        // let path = this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: tx, y: ty }, closeAgents);

        if(USE_PDDL && planName && planName === "patrolling" && !this.agent.mapStats.spawnableArea && !this.agent.mapStats.onlySpawnable) {
            path = await onlineSolverPatrol( this.agent.me.id, Math.round(this.agent.me.x), Math.round(this.agent.me.y), tx, ty, this.agent.myIslandMap.tiles, this.reachableSpawn,this.agent.tilesHeatmap, closeAgents);
        }
        else {
            path = this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: tx, y: ty }, closeAgents);
        }


        if (!path?.length) throw new Error("Plan could not complete");

        // Share plan for visualization with other agents
        this.agent.globalPlan = path.map(s => ({
            type: ActionType.MOVE,
            source: s.current,
            action: s.action
        }));

        this.agent.riders.forEach(r => {
            if (r.player_init) r.plan = this.agent.globalPlan;
        });

        // Execute each step in path
        while (path.length) {
            if (this.stopped) throw new Error("stopped");
            const length = path.length;
            const step = path.shift();
            let status = await this.agent.client.emitMove(step.action);


            const racer = Array.from(this.agent.agents.values()).find(other => {
                if (other.id === this.agent.me.id || !other.last_move || other.id === this.agent.buddyId) {
                    return false;
                }

                const theirPath = this.agent.searchFunction(
                    { x: other.x, y: other.y },
                    { x: tx, y: ty });
                if (!theirPath) return false;
                
                // If the buddy is much closer, let them handle it
                if (other.id === this.agent.buddyId && theirPath.length < path.length - Math.min(10, this.agent.deliverooConfig.AGENTS_OBSERVATION_DISTANCE)) {
                    return true;
                }

                // If they have a strictly shorter path and same first direction, they beat us
                if (theirPath.length >= path.length) return false;
                const firstAction = theirPath[0].action;
                return other.last_move === firstAction;
            });

            if (racer) {
                console.warn("Parcel is being raced by another agent:", racer.id);
                throw new Error("Raced by another agent: " + racer.id);
            }




            if (!status){
                console.warn(`Move failed, replanning…`);
                //check other agents distances using manhattan distance. exclude buddy and return the min distance
                let tooClose = false;
                for (const a of this.agent.agents.values()) {
                    if (a.id === this.agent.buddyId) continue;
                    const md = manhattanDistance(a.x, a.y , this.agent.me.x,this.agent.me.y );
                    if (md < 2){
                        tooClose = true;
                        break;
                    }
                }
                path = this.agent.searchFunction({ x: this.agent.me.x, y: this.agent.me.y }, { x: tx, y: ty }, this.agent.agents);
                let buddyX = Math.round(this.agent.me.x);
                let buddyY = Math.round(this.agent.me.y);
                
                if (step.action === 'right') buddyX += 1;
                else if (step.action === 'left') buddyX -= 1;
                else if (step.action === 'up') buddyY += 1;
                else if (step.action === 'down') buddyY -= 1;
                const buddy = Array.from(this.agent.agents.values()).find(a => a.id === this.agent.buddyId);

                if (!path?.length) {
                    if (buddy && Math.abs(buddy.x - Math.round(this.agent.me.x)) <= 2 && Math.abs(buddy.y - Math.round(this.agent.me.y)) <= 2 && !tooClose) {
                        const oppositeAction = step.action === 'right' ? 'left' :
                        step.action === 'left' ? 'right' :
                        step.action === 'up' ? 'down' : 'up';
                        await this._buddyDelivery(oppositeAction);

                        return true;
                    }
                    throw new Error("Plan could not complete");
                }
                if (buddy && Math.abs(buddy.x - Math.round(this.agent.me.x)) <= 2 && Math.abs(buddy.y - Math.round(this.agent.me.y)) <= 2 && length + 5 < path.length && !tooClose) {
                    const oppositeAction = step.action === 'right' ? 'left' :
                        step.action === 'left' ? 'right' :
                        step.action === 'up' ? 'down' : 'up';
                    await this._buddyDelivery(oppositeAction);
                    return true;
                }

                // Update shared plan for visualization
                this.agent.globalPlan = path.map(s => ({
                    type: ActionType.MOVE,
                    source: s.current,
                    action: s.action
                }));

                this.agent.riders.forEach(r => {
                    if (r.player_init) r.plan = this.agent.globalPlan;
                });

                const next = path.shift();
                status = await this.agent.client.emitMove(next.action);
                
            }

            this.agent.globalPlan.shift();

            // Opportunistic actions: deliver if on delivery tile
            const tile = this.agent.map.getTile(status.x, status.y);
            if (tile?.type === 2 && this.agent.me.carrying.size) {
                await this.agent.client.emitPutdown();
                this.agent.sensingEmitter.emit("parcel_delivery");
                break;
            }

            // Opportunistic pickup if we pass a parcel and is not into locked
            for (const p of this.agent.parcels.values()) {
                if (p.x === status.x && p.y === status.y && !p.carriedBy) {
                    await this.agent.client.emitPickup();
                    this.agent.sensingEmitter.emit("parcel_pickup");
                    break;
                }
            }

            // Stop when we reach the final destination
            if (status.x === tx && status.y === ty) break;
        }

        return true;
    }
}

// Register all concrete plans in order of priority
const planLibrary = [GoPickUp, GoDeliver, Patrolling, SearchFunctionMove ];

// ----- Intention Revision (Deliberation) -----

/**
 * Handles selecting and scheduling which intentions to pursue based on sensed events and utility calculations.
 */
export class IntentionRevision {

    constructor(agent) {
        this.agent = agent;    // Reference to agent
        this.queue = [];       // Pending intention jobs sorted by utility
        this.reachableSpawn = [];
        this.reachableDelivery = [];
        this.current = null;   // Currently executing intention
        this.easyPatrol = false; // Flag for single-tile patrol
        this.agent.lockedParcels = new Map();;
        this.MAX_DELIVERY_TRY = 10; // Max delivery attempts before giving up
        this.wait = false; // Flag to wait for new parcels
        // Subscribe to events that trigger replanning
        agent.sensingEmitter.on("new_parcel", () => this._replan());
        agent.sensingEmitter.on("parcel_pickup", () => this._replan());
        agent.sensingEmitter.on("parcel_delivery", () => this._replan());
        agent.sensingEmitter.on("agent_stay", () => this._replan());
    }

    /**
     * Calculate pickup utility: reward * probability / (distance+1)
     * Avoid parcels being contested by other agents.
     */
    computeParcelUtility(from, parcel) {
        const myPath = this.agent.searchFunction(from, parcel, this.agent.agents);
        const parcels_decay = Math.round(myPath?.length * this.agent.MOVEMENT_DURATION() * 10 / this.agent.PARCEL_DECADING_INTERVAL());
        // Check if the time to reach the parcel is greater than the time of the total reward to be delivered
        if (!myPath || parcels_decay >= parcel.reward + 1) {
            // console.warn("Parcel path is too long compared to reward:", myPath.length);
            return -Infinity;
        }

        // Detect if another agent is closer and moving toward this parcel
        const racer = Array.from(this.agent.agents.values()).find(other => {
            if (other.id === this.agent.me.id || !other.last_move || other.id === this.agent.buddyId) {
                return false;
            }

            const theirPath = this.agent.searchFunction(
                { x: other.x, y: other.y },
                parcel);
            if (!theirPath) return false;
            
            // If the buddy is much closer, let them handle it
            if (other.id === this.agent.buddyId && theirPath.length < myPath.length - Math.min(10, this.agent.deliverooConfig.AGENTS_OBSERVATION_DISTANCE)) {
                return true;
            }

            // If they have a strictly shorter path and same first direction, they beat us
            if (theirPath.length >= myPath.length) return false;
            const firstAction = theirPath[0].action;
            return other.last_move === firstAction;
        });

        const decay = Math.exp(
            -myPath?.length * this.agent.MOVEMENT_DURATION() /
            this.agent.PARCEL_DECADING_INTERVAL()
        );

        if (racer) {
            // console.warn("Parcel is being raced by another agent:", racer.id);
            return -Infinity;
        }

        // Utility formula
        return (parcel.reward * parcel.probability * decay) / (myPath.length + 1);
    }

    /**
     * Compute delivery utility with exponential decay based on travel time
     */
    computeDeliveryUtility() {
        const carried = Array.from(this.agent.me.carrying.values());
        if (!carried.length) return -Infinity;

        //find the best parcel
        const bestParcel = Math.max(...carried.map(p => p.reward));
        const totalReward = carried.reduce((sum, p) => sum + p.reward, 0);
        const dest = findNearestDelivery(this.agent.me, this.agent.myIslandMap);
        if (!dest) return -Infinity;
        const agentsWOBuddy = Array.from(this.agent.agents.values()).filter(a => a.id !== this.agent.buddyId);

        const pathHome = this.agent.searchFunction(this.agent.me, dest, agentsWOBuddy);
        const parcels_decay = Math.round(pathHome?.length * this.agent.MOVEMENT_DURATION() * 3 / this.agent.PARCEL_DECADING_INTERVAL());
        if (!pathHome && this.deliveryTry <= this.MAX_DELIVERY_TRY) {
            this.deliveryTry+=1;
            return 1;
        }
        this.deliveryTry = 0;
        //check if the time to reach the delivery tile is greater than the time of the total reward to be delivered
        if (!pathHome || parcels_decay >= bestParcel + 1) {
            // console.warn("Delivery path is too long compared to reward:", pathHome.length);
            return -Infinity;
        }
        const efficiencyFactor = Math.log1p(totalReward * pathHome.length) / 10;

        return (totalReward * efficiencyFactor) / (pathHome?.length + 1);
    }

    /**
     * Replan: recalculate pickup and delivery options, update queue
     */
    _replan() {
        const from = { x: this.agent.me.x, y: this.agent.me.y };
        const pickupOptions = [];
        // Evaluate all free parcels
        for (const p of this.agent.parcels.values()) {
            if (!p.carriedBy && !this.agent.lockedParcels.has(p.id)) {
                const util = this.computeParcelUtility(from, p);
                if (util > 0) pickupOptions.push({ parcel: p, util });
            }
        }

        // Sort by descending utility
        pickupOptions.sort((a, b) => b.util - a.util);
        const deliverUtil = this.computeDeliveryUtility();

        // If no pickup options but still have carried parcels and non-positive deliver utility => patrol
        if (pickupOptions.length === 0 && this.agent.parcels.size && deliverUtil <= 0) {
            this.queue = [{ type: "patrol", util: 0 }];
            return;
        }

        // Reset queue; push deliver if best, then pickups by utility
        this.queue = [];
        if (pickupOptions.length) {
            if (deliverUtil > pickupOptions[0].util) {
                this.queue.push({ type: "deliver", util: deliverUtil });
            }
            for (const o of pickupOptions) {
                this.queue.push({ type: "pickup", parcel: o.parcel, util: o.util });
            }
        } else if (deliverUtil > 0) {
            this.queue.push({ type: "deliver", util: deliverUtil });
        }

        // If still empty, default to patrol
        if (!this.queue.length) {
            this.queue.push({ type: "patrol", util: 0 });
        }

        // Interrupt current intention if job type changed
        this.current?.intent.stop();
    }

    /**
     * If next queue job differs from current, stop current
     */
    _maybeInterrupt() {
        const next = this.queue[0];
        if (this.current && next && this.current.type !== next.type) {
            this.current?.intent.stop();
        }
    }

    /**
     * Main loop: wait for map data, initialize reachable tiles, then continuously select and execute intentions
     */
    async loop() {
        // Wait until island map tiles are loaded
        while (!this.agent.myIslandMap.tiles.size) {
            await new Promise(r => setTimeout(r, 100));
        }
        this.agent.client.onMsg( async (id, name, /**@type {{type:string,parcel:string}}*/msg, reply) => {
            if (msg.type === "lock_parcel") {
                let parcel = this.agent.parcels.get(msg.parcel);
                if (!parcel){
                    this.agent.lockedParcels.set(msg.parcel, { x: -1, y: -1 });
                    return;
                }

                this.agent.lockedParcels.set(msg.parcel, { x: parcel.x, y: parcel.y });
            }
            else if (msg.type === "unlock_parcel") {
                this.agent.lockedParcels.delete(msg.parcel);
            }else if (msg.type === "stop") {
                this.wait = true;
                this.current?.intent.stop();
                this.current = null;
            }

        });


        // Partition tiles by type: '1'=spawn, '2'=delivery
        for (const tile of this.agent.myIslandMap.tiles.values()) {
            if (tile.type == '1') this.reachableSpawn.push(tile);
            else if (tile.type == '2') this.reachableDelivery.push(tile);
        }

        // If only one spawn tile, mark for easy patrol
        if (this.reachableSpawn.length === 1) this.easyPatrol = true;

        // Continuous deliberation-execution
        while (true) {
            this._maybeInterrupt();
            if (this.wait) {
                await new Promise(r => setTimeout(r, 300));
                this.wait = false;
                this._replan();
            }
            if (!this.queue.length) this._replan();
            const job = this.queue.shift();

            let predicate;
            switch (job.type) {
                case "deliver":
                    predicate = ["go_deliver"];
                    break;
                case "pickup":
                    predicate = ["go_pick_up", job.parcel.x, job.parcel.y, job.parcel.id, job.parcel.reward];
                    break;
                default:
                    predicate = ["patrolling", this.easyPatrol];
            }

            this.current = {
                type: job.type,
                intent: new Intention(this.agent, predicate, this.reachableSpawn, this.reachableDelivery)
            };

            try {
                // Attempt to achieve current intention
                await this.current.intent.achieve();
            } catch (e) {
                if(!this.wait){
                    this.current?.intent.stop();
                    this.current = null;
                    this._replan();
                }
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}
