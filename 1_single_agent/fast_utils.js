// FASTv0 fast_utils.js

import { aStarSearch } from "./main.js";
import { TUNNEL_MIN_LENGTH, MAX_INT } from "./FASTconfig.js";



// DELIVEROO CONFIGURATION =================== //
/**
 * @param {import("./Types.js").ClockEvent} event
 * @returns {number} Milliseconds
 */
export function clockEventToMs(event) {
    switch (event) {
        case 'frame': return 50; // 20 FPS
        case '1s': return 1000;
        case '2s': return 2000;
        case '5s': return 5000;
        case '10s': return 10000;
        case 'infinite': return MAX_INT;
        default: return MAX_INT;
    }
}



// MAP STATS ============================ //

/**
 * Returns the number of islands in the map, and a set of tiles for each island.
 * - islandsNumber: number of islands in the map
 * - islands: array of arrays, each containing the tiles of an island
 */
export function getIslands(map) {
    const visited = new Set();
    const islands = [];

    /**
     * @param {{ type: string, x: number, y: number }} tile
     */
    const dfs = (tile, island) => {
        visited.add(tile);
        island.push(tile);

        // Compute neighbors dynamically based on map structure
        const neighbors = Array.from(map.tiles.values()).filter(
            t => (Math.abs(t.x - tile.x) === 1 && t.y === tile.y) || 
             (Math.abs(t.y - tile.y) === 1 && t.x === tile.x)
        );

        for (const neighbor of neighbors) {
            if (!visited.has(neighbor) && neighbor.type != '0') {
                dfs(neighbor, island);
            }
        }
    }

    for (const tile of map.tiles.values()) {
        if (!visited.has(tile) && tile.type != '0') {
            const island = [];
            dfs(tile, island);
            islands.push(island);
        }
    }

    return { islandsNumber: islands.length, islands };
}

/**
 * Compute useful map statistics (map of a single island):
 * - tilesNumber: number of tiles in the map
 * - blockTilesNumber: number of block tiles (type 0)
 * - spawnableTilesNumber: number of spawnable tiles (type 1)
 * - deliveryTilesNumber: number of delivery tiles (type 2)
 * - walkableTilesNumber: number of walkable tiles (type 3)
 * - openField: boolean, whether all (or most) tiles are reachable (i.e., not of type 0)
 * - onlySpawnable: boolean, whether all (or most) non-delivery and non-block tiles are spawnable (i.e., not of type 3)
 * - spawnableArea: boolean, whether all spawnable tiles are in one area of the map (if spawnableTiles == 1, this is true)
 * - deliveryArea: boolean, whether all delivery tiles are in one area of the map (if deliveryTiles == 1, this is true)
 * - tunnel: boolean, whether between spawnable area and delivery area there is a tunnel (i.e., all paths need to go through a specific tile)
 * @returns {Object} mapStats
 */
export function computeMapStats(map, islandMapTiles) {
    const mapStats = {
        tilesNumber: islandMapTiles.length,
        blockTilesNumber: islandMapTiles.filter(tile => tile.type == '0').length,
        spawnableTilesNumber: islandMapTiles.filter(tile => tile.type == '1').length,
        deliveryTilesNumber: islandMapTiles.filter(tile => tile.type == '2').length,
        walkableTilesNumber: islandMapTiles.filter(tile => tile.type == '3').length,
        openField: false,
        onlySpawnable: false,
        deliveryArea: false,
        spawnableArea: false,
        tunnel: false
    };

    // 1) compute open field and only spawnable
    if (mapStats.blockTilesNumber == 0) {
        mapStats.openField = true;
    }
    if (mapStats.walkableTilesNumber == 0) {
        mapStats.onlySpawnable = true;
    }

    // 2) compute spawnable area
    if (mapStats.onlySpawnable) {
        mapStats.spawnableArea = false;
    } else if (mapStats.spawnableTilesNumber == 1) {
        // trivial case: only one tile
        mapStats.spawnableArea = true;
    } else {
        // general case: check if all tiles are adjacent or have at most one tile (non-block) between them
        const firstspawnableTile = islandMapTiles.find(tile => tile.type == '1'); // get first tile from which to start DFS
        const spawnableTiles = new Set(islandMapTiles.filter(tile => tile.type == '1'));
        const spawnableTilesVisited = new Set();
        const dfs = (tile) => {
            spawnableTilesVisited.add(tile);
            const neighbors = Array.from(map.tiles.values()).filter(
                t => manhattanDistance(t.x, t.y, tile.x, tile.y) <= 2 && t.type != '0'
            );
            for (const neighbor of neighbors) {
                if (spawnableTiles.has(neighbor) && !spawnableTilesVisited.has(neighbor)) {
                    dfs(neighbor);
                }
            }
        }
        dfs(firstspawnableTile);
        if (spawnableTilesVisited.size == mapStats.spawnableTilesNumber) {
            mapStats.spawnableArea = true;
        } else {
            mapStats.spawnableArea = false;
        }
    }

    // 3) compute delivery area
    if (mapStats.deliveryTilesNumber == 1) {
        // trivial case: only one tile
        mapStats.deliveryArea = true;
    } else {
        // general case: check if all tiles are adjacent or have at most one tile (non-block) between them
        const firstdeliveryTile = islandMapTiles.find(tile => tile.type == '2'); // get first tile from which to start DFS
        const deliveryTiles = new Set(islandMapTiles.filter(tile => tile.type == '2'));
        const deliveryTilesVisited = new Set();
        const dfs = (tile) => {
            deliveryTilesVisited.add(tile);
            const neighbors = Array.from(map.tiles.values()).filter(
                t => manhattanDistance(t.x, t.y, tile.x, tile.y) <= 2 && t.type != '0'
            );
            for (const neighbor of neighbors) {
                if (deliveryTiles.has(neighbor) && !deliveryTilesVisited.has(neighbor)) {
                    dfs(neighbor);
                }
            }
        }
        dfs(firstdeliveryTile);
        if (deliveryTilesVisited.size == mapStats.deliveryTilesNumber) {
            mapStats.deliveryArea = true;
        } else {
            mapStats.deliveryArea = false;
        }
    }

    // 4) compute tunnel
    if (mapStats.spawnableArea || mapStats.deliveryArea) {
        // Use DFS to get a path from one spawnable tile to one delivery tile
        const spawnableTile = islandMapTiles.find(tile => tile.type == '1');
        const deliveryTile = islandMapTiles.find(tile => tile.type == '2');
        const path = aStarSearch(spawnableTile, deliveryTile);
        
        // Check if there are tiles with exactly 2 neighbors in the path
        const hasTilesWithTwoNeighbors = (path, consecutiveTiles) => {
            let tileWithTwoNeighborsCount = 0;
            for (const step of path) {
                const neighbors = Array.from(map.tiles.values()).filter(
                    t => manhattanDistance(t.x, t.y, step.current.x, step.current.y) <= 1 && t.type != '0'
                );
                if (neighbors.length == (3)) { // 2 neighbors + the tile itself
                    tileWithTwoNeighborsCount++;
                    if (tileWithTwoNeighborsCount >= consecutiveTiles) {
                        return true; // More than one tile with exactly 2 neighbors
                    }
                } else {
                    tileWithTwoNeighborsCount = 0; // Reset count if we find a tile with more than 2 neighbors
                }
            }
            return false;
        }
        if (path && path.length > 0) {
            const hasTunnel = hasTilesWithTwoNeighbors(path, TUNNEL_MIN_LENGTH);
            if (hasTunnel) {
                mapStats.tunnel = true;
            }
        }
    }

    return mapStats;
}


// DISTANCE FUNCTIONS =================== //

// Euclidean distance
export function euclideanDistance({ x: x1, y: y1 }, { x: x2, y: y2 }) {
    const dx = Math.abs(Math.round(x1) - Math.round(x2));
    const dy = Math.abs(Math.round(y1) - Math.round(y2));
    return dx + dy;
}

// Find the nearest delivery tile from a given position
export function findNearestDelivery(from, map) {
    // 1) collect all delivery tiles (type is numeric 2)
    const deliveries = Array.from(map.tiles.values()).filter(tile => tile.type == '2');
    if (deliveries.length === 0) return null;
    
    // 2) build list of only the *reachable* ones
    const reachable = [];
    for (const tile of deliveries) {
        const path = aStarSearch(from, tile);
        if (path && path.length > 0) {
        reachable.push({ tile, dist: path.length });
        }
    }
    
    // 3) if we found any reachable, return the closest
    if (reachable.length > 0) {
        reachable.sort((a, b) => a.dist - b.dist);
        return reachable[0].tile;
    }
    
    // 4) otherwise nobody is reachable right now → pick by straight-line
    deliveries.sort((a, b) => {
        const da = manhattanDistance(from, a);
        const db = manhattanDistance(from, b);
        return da - db;
    });
    return deliveries[0];
}

// Manhattan distance
export function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

// Fast nearest delivery tile (optimized for open-field)
export function fastNearestDelivery(from, map) {
    const deliveries = Array.from(map.tiles.values()).filter(tile => tile.type == '2');
    if (deliveries.length === 0) return null;
    deliveries.sort((a, b) => {
        const dA = manhattanDistance(a.x, a.y, from.x, from.y);
        const dB = manhattanDistance(b.x, b.y, from.x, from.y);
        return dA - dB;
    });
    return deliveries[0];
}

