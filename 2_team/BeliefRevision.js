import { manhattanDistance, findNearestDelivery, computeMapStats, getIslands } from "./fast_utils.js";
import { MIN_STEPS_TO_UPDATE, PARCEL_SHARING, OPPONENTS_SHARING } from "./FASTconfig.js";


// MAP ======================================================================== //
export function createDeliverooMap() {
    return {
        width: undefined,
        height: undefined,
        tiles: new Map(),
        initialized: false,
        add(tile) {
            this.tiles.set(tile.x+"_"+tile.y, tile);
        },
        getTile(x, y) {
            return this.tiles.get(x+"_"+y);
        }
    };
}


// PARCELS ====================================================================== //
/**
 * A parcel object extended with a probability field.
 * 
 * Based on:
 * {@link import("@unitn-asa/deliveroo-js-client/types/ioTypedSocket.cjs").parcel}
 * with an additional `probability: number` property.
 */
export class FASTParcel {
    constructor( deliverooParcel, parcelDecadingInterval, probability=1) {
        this.id = deliverooParcel.id;
        this.x = deliverooParcel.x;
        this.y = deliverooParcel.y;
        this.carriedBy = deliverooParcel.carriedBy;
        this.reward = deliverooParcel.reward;
        this.probability = probability;
        this.interval = setInterval( () => {
            this.reward -= 1;
        }, Number(parcelDecadingInterval) );
    }
    destroy(map) {
        clearInterval(this.interval);
        map.delete(this.id);
    }
}
/**
 * Set a parcel in the map, destroying the previous one if it exists.
 * This avoids memory leaks and ensures all intervals are cleared.
 * @param {Map<string, FASTParcel>} parcel_map - The map to set the parcel in.
 * @param {FASTParcel} fastParcel - The parcel to set.
 * */
function setParcel(parcel_map, fastParcel) {
    parcel_map.get(fastParcel.id)?.destroy(parcel_map);
    parcel_map.set(fastParcel.id, fastParcel);
}

export async function shareParcelWithBuddy(p, client, buddyId, msgType = "parcel_perceived") {
    if (!PARCEL_SHARING) return; // If parcel sharing is disabled, do not share parcels
    if (msgType == "parcel_perceived") {
        const parcel = p.id + "_" + p.x + "_" + p.y + "_" + p.reward;
        await client.emitSay(buddyId, {
            type: "parcel_perceived",
            parcel: parcel
        });
    } else if (msgType == "parcel_destroyed") {
        await client.emitSay(buddyId, {
            type: "parcel_destroyed",
            id: p.id
        });
    }
}

export async function shareAgentWithBuddy(agent, client, buddyId) {
    if (!OPPONENTS_SHARING) return; // If opponent sharing is disabled, do not share agents
    const agentData = agent.id + "_" + Math.round(agent.x) + "_" + Math.round(agent.y);
    await client.emitSay(buddyId, {
        type: "agent_perceived",
        agent: agentData
    });
}


// AGENTS ====================================================================== //
/**
 * @typedef fastAgent
 * @type {import("@unitn-asa/deliveroo-js-client/types/ioTypedSocket.cjs").agent & { last_move: string, probability: number }}
 * * An agent object extended with a last_move field and a probability field.
 * */


// HEATMAP ====================================================================== //
/**
 * A heatmap object that stores the current values of tiles based on their distance to the nearest delivery tile and the positions of agents.
 * If the number of delivery tiles is more than 50, all tiles are initialized to 1.
 * */
export class Heatmap {
    constructor(map, me, agents, searchFunction) {
        this.map = map;
        this.me = me;
        this.agents = agents;
        this.searchFunction = searchFunction;
        this.heatmap = new Map();
        this.initialized = false;
    }
    init() {
        this.heatmap.clear();
        // If the number of tiles of type 1 is more than 50, initialize all to 1
        const type1Tiles = Array.from(this.map.tiles.values()).filter(tile => tile.type == '1');
        this.initialized = true;
        if (type1Tiles.length > 200) {
            console.log("FAST Heatmap to 1");
            for (const tile of type1Tiles) {
                const key = tile.x + '_' + tile.y;
                this.heatmap.set(key, {
                    orig_value: 1,
                    current_value: 1
                });
            }
            return;
        } else {
            // Otherwise, initialize the heatmap based on the distance to the nearest delivery tile
            console.log("Heatmap with distance to delivery tile");
            for (const tile of type1Tiles) {
                const deliveryTile = findNearestDelivery(tile, this.map);
                const distanceToDelivery = this.searchFunction(tile, deliveryTile).length;
                const value = Math.exp(-distanceToDelivery / (0.5*(this.map.width + this.map.height)) );
                const key = tile.x + '_' + tile.y;
                this.heatmap.set(key, {
                    orig_value: value,
                    current_value: value
                });
            }
            console.log("Heatmap:", this.getHeatmap());
        }
    }
    restore() {
        for (const [key, entry] of this.heatmap.entries()) {
            entry.current_value = entry.orig_value;
        }
    }
    update() {
        // Update the heatmap based on the current positions of the agents
        const sigma = 2;
        const radius = Math.ceil(sigma * 3);
        
        // 1. Restore the original values of the heatmap (to avoid decay)
        this.restore();

        // 2. Update the heatmap based on the agents' positions
        for (const agent of this.agents.values()) {
            if (agent.id === this.me.id) continue; // skip self
            const x = Math.round(agent.x);
            const y = Math.round(agent.y);
    
            for (let i = -radius; i <= radius; i++) {
                for (let j = -radius; j <= radius; j++) {
                    const tileX = x + i;
                    const tileY = y + j;
                    const tileKey = `${tileX}_${tileY}`;
    
                    if (this.heatmap.has(tileKey)) {
                        const distanceSquared = i * i + j * j;
                        const gauss = Math.exp(-distanceSquared / (2 * sigma * sigma));
                        const diminish = 0.5 * gauss; // half the value of the gaussian to ensure it never brings the value to 0
                        const entry = this.heatmap.get(tileKey);
                        entry.current_value = entry.current_value * (1 - diminish);
                    }
                }
            }
        }
    }
    /**
     * Get the current heatmap values.
     * @returns {Map<string, number>} A map of the current heatmap values.
     */
    getHeatmap() {
        const currentMap = new Map();
        for (const [key, { current_value }] of this.heatmap.entries()) {
            currentMap.set(key, current_value);
        }
        return currentMap;
    }    
    getTile(x, y) {
        const entry = this.heatmap.get(x + '_' + y);
        return entry ? entry.current_value : undefined;
    }
}


export class BeliefRevision {
    constructor(agent) {
        this.agent = agent;
        this.prev_position = { x: -10, y: -10 };
    }

    startSensing() {
        this.agent.client.onYou( async ({ id, name, x, y, score }) => {
            Object.assign(this.agent.me, { id, name, x, y, score });
            const cur_position = { x: Math.round(x), y: Math.round(y) };
            if (Math.abs(this.prev_position.x-cur_position.x) + Math.abs(this.prev_position.y-cur_position.y) >= MIN_STEPS_TO_UPDATE) { // Update only if the agent has moved more than 1 tile (to avoid sending too many messages)
                this.prev_position = cur_position;
                // Send update only if the distance between me and the buddy is greater than the observation distance
                const buddyX = this.agent.buddyId ? this.agent.agents.get(this.agent.buddyId)?.x : -10;
                const buddyY = this.agent.buddyId ? this.agent.agents.get(this.agent.buddyId)?.y : -10;
                if (buddyX && buddyY && manhattanDistance(buddyX, buddyY, cur_position.x, cur_position.y) > this.agent.PARCELS_OBSERVATION_DISTANCE()) {
                    await this.agent.client.emitSay(this.agent.buddyId, {
                        type: "buddy_update",
                        position: `${cur_position.x}_${cur_position.y}`
                    });
                }
            }
            if (!this.agent.myIslandMap.initialized) {
                if (!this.agent.map.initialized) {
                    console.error("Map not initialized yet when trying to get island I am in");
                    return;
                }
                const { islandsNumber, islands } = getIslands(this.agent.map);
                console.log("Islands number: ", islandsNumber);
                const islandImIn = islands.find(island => island.some(tile => tile.x == x && tile.y == y));
                if (!islandImIn) {
                    console.error('\x1b[31m%s\x1b[0m', "I'm not in any island!");
                    return;
                }
                islandImIn.forEach(tile => this.agent.myIslandMap.add(tile));
                this.agent.mapStats = computeMapStats(this.agent.map, islandImIn);
                console.log("Map stats: ", this.agent.mapStats);
                this.agent.myIslandMap.initialized = true;
            }
        });

        this.agent.client.onMap((width, height, tiles) => {
            if (this.agent.map.initialized) return;
            this.agent.map.width = width;
            this.agent.map.height = height;
            tiles.forEach(tile => this.agent.map.add(tile));
            this.agent.map.initialized = true;
            this.agent.tilesHeatmap.init();
        });

        async function parcelUpdate(perceived, fromBuddy = false) {
            // 1. Update no-more-perceived parcels
            if (!fromBuddy) {
                for (const [id, p] of this.agent.parcels) {
                    if (!perceived.find(per => per.id === id)) {
                        if (manhattanDistance(this.agent.me.x, this.agent.me.y, p.x, p.y) < this.agent.PARCELS_OBSERVATION_DISTANCE()-0.5) {
                            p.destroy(this.agent.parcels);
                            await shareParcelWithBuddy(p, this.agent.client, this.agent.buddyId, "parcel_destroyed");
                        } else {
                            if (p.reward <= 0) {
                                p.destroy(this.agent.parcels);
                            } else {
                                p.probability *= 0.95;
                            }
                        }
                        this.agent.me.carrying.delete(id);
                    }
                }
            }

            // 2. Update perceived parcels
            let newParcel = false;
            for (const p of perceived) {
                if (!this.agent.parcels.has(p.id) && !p.carriedBy) {
                    newParcel = true;
                }
                if (!p.carriedBy) {
                    // Check if an agent is on the same tile as the parcel
                    const agentOnTile = Array.from(this.agent.agents.values()).find(a => Math.round(a.x) === p.x && Math.round(a.y) === p.y);
                    if (agentOnTile) {
                        // if (agentOnTile.id === this.agent.buddyId) {
                        //     await shareParcelWithBuddy(p, this.agent.client, this.agent.buddyId);
                        // }
                        this.agent.parcels.get(p.id)?.destroy(this.agent.parcels);
                        newParcel = false; // Note: in this case, we don't want to replan
                        if (!fromBuddy) {
                            await shareParcelWithBuddy(p, this.agent.client, this.agent.buddyId, "parcel_destroyed");
                        }
                    } else {
                        const fp = new FASTParcel(p, this.agent.PARCEL_DECADING_INTERVAL());
                        setParcel(this.agent.parcels, fp);
                        this.agent.me.carrying.delete(p.id);
                        if (newParcel && !fromBuddy) {
                            await shareParcelWithBuddy(fp, this.agent.client, this.agent.buddyId);
                        }
                    }
                } else {
                    if (p.carriedBy === this.agent.me.id) {
                        if (fromBuddy) continue; // Note: parcel carried by me, but perceived from buddy
                        const fp = new FASTParcel(p, this.agent.PARCEL_DECADING_INTERVAL());
                        setParcel(this.agent.parcels, fp);
                        this.agent.me.carrying.set(p.id, fp);
                    } else {
                        this.agent.parcels.get(p.id)?.destroy(this.agent.parcels);
                        this.agent.me.carrying.delete(p.id);
                        if (!fromBuddy && p.carriedBy !== this.agent.buddyId) {
                            await shareParcelWithBuddy(p, this.agent.client, this.agent.buddyId, "parcel_destroyed");
                        }
                    }
                }
            }
            if (newParcel && !fromBuddy) { // Note: if the new parcel is perceived from the buddy, we don't emit the event (don't want to replan)
                this.agent.sensingEmitter.emit("new_parcel");
            }
            return;
        }

        this.agent.client.onParcelsSensing( async (perceived) => {
            parcelUpdate.call(this, perceived);
        });

        this.agent.client.onMsg( async (id, name, /**@type {{type:string, parcel:string}}*/ msg, reply) => {
            if (msg.type === "parcel_perceived" && id == this.agent.buddyId) {
                let parcel = msg.parcel.split("_");
                let p = {
                    id: parcel[0],
                    x: Number(parcel[1]),
                    y: Number(parcel[2]),
                    reward: Number(parcel[3])
                }
                parcelUpdate.call(this, [p], true);
            }
        });

        this.agent.client.onMsg( async (id, name, /**@type {{type:string, id:string}}*/ msg, reply) => {
            if (msg.type === "parcel_destroyed" && id == this.agent.buddyId) {
                const p = this.agent.parcels.get(msg.id);
                if (p && (!p.carriedBy || p.carriedBy !== this.agent.me.id)) { // if the parcel is in my beliefset and is not carried by me
                    p.destroy(this.agent.parcels);
                }
            }
        });

        this.agent.client.onAgentsSensing( async (perceived) => {
            let newAgent = false;

            for (const a of perceived) {
                if (this.agent.agents.has(a.id)) {
                    const existingAgent = this.agent.agents.get(a.id);
                    if (existingAgent.probability < 1) newAgent = true;
                } else newAgent = true;
                if (a.id !== this.agent.buddyId) {
                    await shareAgentWithBuddy(a, this.agent.client, this.agent.buddyId);
                }

                let last_move = undefined;
                // 1. Check if the agent is moving (i.e. has an x value of x.4 or x.6)
                if (a.x % 1 !== 0) {
                    last_move = a.x % 1 > 0.5 ? "right" : "left";
                } else if (a.y % 1 !== 0) {
                    last_move = a.y % 1 > 0.5 ? "up" : "down";
                } else {
                    // 2. Check if the agent has moved (i.e. has integer x and y values but different from the previous ones)
                    const previousAgent = this.agent.agents.get(a.id);
                    if (previousAgent) {
                        last_move = previousAgent.last_move;
                        if (previousAgent.x !== a.x) {
                            last_move = a.x > previousAgent.x ? "right" : "left";
                        } else if (previousAgent.y !== a.y) {
                            last_move = a.y > previousAgent.y ? "up" : "down";
                        }
                    }
                }
                this.agent.agents.set(a.id, { ...a, last_move: last_move, probability: 1 });
            }

            for (const [id] of this.agent.agents) {
                if (!perceived.find(a => a.id === id)) {
                    const agent = this.agent.agents.get(id);
                    if (agent.probability < 0.8 && id !== this.agent.buddyId) {
                        this.agent.agents.delete(id);
                    } else {
                        if (agent.probability < 1) agent.last_move = undefined; // NOTE: keep last_move for one iteration
                        agent.probability *= 0.95;
                    }
                }
            }

            // Heatmap update
            if (this.agent.tilesHeatmap.initialized && this.agent.agents.size > 0) {
                this.agent.tilesHeatmap.update();
            }

            if (newAgent) {
                this.agent.sensingEmitter.emit("new_agent");
            }
        });

        this.agent.client.onMsg( async (id, name, /**@type {{type:string, position:string}}*/ msg, reply) => {
            if (msg.type === "buddy_update" && id == this.agent.buddyId) {
                this.agent.agents.set(id, {
                    ...this.agent.agents.get(id),
                    x: Number(msg.position.split("_")[0]),
                    y: Number(msg.position.split("_")[1])
                });
            }
        });

        this.agent.client.onMsg( async (id, name, /**@type {{type:string, agent:string}}*/ msg, reply) => {
            if (msg.type === "agent_perceived" && id == this.agent.buddyId) {
                let agent = msg.agent.split("_");
                let a = {
                    id: agent[0],
                    x: Number(agent[1]),
                    y: Number(agent[2]),
                    name: undefined,
                    teamId: undefined,
                    teamName: undefined,
                    score: undefined,
                    penalty: undefined,
                    last_move: undefined,
                    probability: 1
                }
                if (!this.agent.agents.has(a.id)) {
                    this.agent.agents.set(a.id, a);
                } else {
                    const existingAgent = this.agent.agents.get(a.id);
                    if (existingAgent.probability < 1) this.agent.agents.set(a.id, a);
                }
            }
        });
    }
}
