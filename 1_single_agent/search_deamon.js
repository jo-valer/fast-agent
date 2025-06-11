/**
 * Compute Manhattan distance between two points.
 */
function manhattanDistance(a, b) {
    const dx = Math.abs(Math.round(a.x) - Math.round(b.x));
    const dy = Math.abs(Math.round(a.y) - Math.round(b.y));
    return dx + dy;
}

export default function (map) {
/**
 * @typedef Tile
 * @property {number} x
 * @property {number} y
 * @property {string} type
 * @property {boolean} [locked]             // temporarily marked obstacle
 * @property {number} [gScore]             // cost from start
 * @property {Tile}   [cameFrom]           // previous tile in path
 * @property {string} [cameFromAction]     // action taken to get here
 */

/** @type {Map<string, Tile>} */
const tileMap = map;

/**
 * Reset all per-search metadata from the map.
 */
function clearSearchMetadata() {
    for (const tile of tileMap.values()) {
    delete tile.locked;
    delete tile.gScore;
    delete tile.cameFrom;
    delete tile.cameFromAction;
    }
}

/**
 * Mark all currently occupied agent positions as non-walkable.
 * @param {Map<any, {x:number,y:number}>} agents
 */
function lockAgentPositions(agents) {
    for (const { x, y } of agents.values()) {
    const keys = [
        `${Math.ceil(x)}_${Math.ceil(y)}`,
        `${Math.floor(x)}_${Math.floor(y)}`
    ];
    keys.forEach((k) => {
        const tile = tileMap.get(k);
        if (tile) tile.locked = true;
    });
    }
}

/**
 * Reconstruct the path from goal tile back to start.
 * @param {Tile} goalTile
 * @returns {Array<{step:number, action:string, current:{x:number,y:number}}>}
 */
function reconstructPath(goalTile) {
    const path = [];
    let current = goalTile;
    while (current.cameFrom) {
    path.unshift({
        step: current.gScore,
        action: current.cameFromAction,
        current: { x: current.x, y: current.y }
    });
    current = current.cameFrom;
    }
    return path;
}

/**
 * A* search from (initX, initY) to (targetX, targetY) avoiding occupied/blocked tiles.
 * @returns { Array<{step:number,action:string,current:{x:number,y:number}}> | null }
 */
return function aStarSearch(
    { x: initX, y: initY },
    { x: targetX, y: targetY },
    agents = new Map()
) {
    initX = Math.round(initX);
    initY = Math.round(initY);
    targetX = Math.round(targetX);
    targetY = Math.round(targetY);

    clearSearchMetadata();
    lockAgentPositions(agents);

    const startKey = `${initX}_${initY}`;
    const startTile = tileMap.get(startKey);

    // Validate start tile
    if (
        !startTile ||
        startTile.type == "0" ||
        startTile.locked
    ) {
        clearSearchMetadata();
        return null;
    }

    // Initialize start
    startTile.gScore = 0;
    startTile.cameFrom = null;

    /** @type Array<{x:number,y:number, gScore:number}> */
    const openList = [{ x: initX, y: initY, gScore: 0 }];

    let goalTile = null;

    while (openList.length) {
    // Sort by f = gScore + hScore
    openList.sort((a, b) => {
        const fA = a.gScore + manhattanDistance(a, { x: targetX, y: targetY });
        const fB = b.gScore + manhattanDistance(b, { x: targetX, y: targetY });
        return fA - fB;
    });

    const { x: cx, y: cy, gScore: currentG } = openList.shift();
    const currentKey = `${cx}_${cy}`;
    const currentTile = tileMap.get(currentKey);

    if (cx === targetX && cy === targetY) {
        goalTile = currentTile;
        break;
    }

    // Explore 4-neighbors
    for (const [dx, dy, action] of [
        [1, 0, "right"],
        [-1, 0, "left"],
        [0, 1, "up"],
        [0, -1, "down"]
    ]) {
        const nx = cx + dx, ny = cy + dy;
        const neighborKey = `${nx}_${ny}`;
        const neighbor = tileMap.get(neighborKey);

        if (!neighbor) continue;
        if (neighbor.type == "0" || neighbor.locked) continue;

        const tentativeG = currentG + 1;
        if (neighbor.gScore === undefined || tentativeG < neighbor.gScore) {
        neighbor.gScore = tentativeG;
        neighbor.cameFrom = currentTile;
        neighbor.cameFromAction = String(action);
        openList.push({ x: nx, y: ny, gScore: tentativeG });
        }
    }
    }

    // No path found
    if (!goalTile) {
        clearSearchMetadata();
        return null;
    }

    // Build and return the step-by-step plan
    const plan = reconstructPath(goalTile);
    clearSearchMetadata();
    return plan;
};
}
