import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { EventEmitter } from "events";
import { default as argsParser } from "args-parser";
import { DemoDashboard } from "../dashboard/dashboard.js";
import { Position } from "../dashboard/data/position.js";
import { Rider } from "../dashboard/rider.js";
import { BeliefRevision, createDeliverooMap, Heatmap } from "./BeliefRevision.js";
import { IntentionRevision } from "./Planner.js"
import search_deamon from "./search_deamon.js";
import { clockEventToMs } from "./fast_utils.js";

const args = argsParser(process.argv);
export const sensingEmitter = new EventEmitter();

// MAP ======================================================================== //
/** 
 * @typedef deliverooMap
 * @type { { width: number, height: number, tiles: Map<number, import("@unitn-asa/deliveroo-js-client/types/ioTypedSocket.cjs").tile>, add: function, getTile: function } }
 */

/** @type {deliverooMap} */
export const map = createDeliverooMap();

/** @type {deliverooMap} */
export const myIslandMap = createDeliverooMap();


// PARCELS ======================================================================== //
/**
 * @type {Map<string, import("./BeliefRevision.js").FASTParcel>}
 * */
export const parcels = new Map();


// AGENTS ======================================================================== //
/**
 * @type {Map<string, import("./BeliefRevision.js").fastAgent>}
 * */
export const agents = new Map();


// ME ======================================================================== //
/**
 * @typedef parcel
 * @type {import("@unitn-asa/deliveroo-js-client/types/ioTypedSocket.cjs").parcel}
 */
/**
 * @typedef agent
 * @type { { id: string, name: string, x: number, y: number, score: number, carrying: Map<string, parcel> } }
 */

/**
 * Global state of the FAST agent.
 * @type {agent}
 */
export const me = { id: undefined, name: undefined, x: undefined, y: undefined, score: undefined, carrying: new Map() };
console.log("args", args);
// console.log("me", me);
// console.log("args.token", args['token']);
// console.log("args.host", args['host']);

// Global Deliveroo client
export const client = new DeliverooApi(
    args['host'],
    args['token']
);
export const aStarSearch = search_deamon(map.tiles);

// STATS ======================================================================== //
export let mapStats = {};
export const tilesHeatmap = new Heatmap(map, me, agents, aStarSearch);


// Configuration variables.
/**
 * @typedef DeliverooConfig
 * @type { {
 * PORT: number,
 * MAP_FILE: string,
 * PARCELS_GENERATION_INTERVAL: import("./Types.js").parseClockEvent,
 * PARCELS_MAX: number,
 * PARCEL_REWARD_AVG: number,
 * PARCEL_REWARD_VARIANCE: number,
 * PARCEL_DECADING_INTERVAL: import("./Types.js").parseClockEvent,
 * PENALTY: number,
 * MOVEMENT_STEPS: number,
 * MOVEMENT_DURATION: number,
 * AGENTS_OBSERVATION_DISTANCE: number,
 * PARCELS_OBSERVATION_DISTANCE: number,
 * CLOCK: number
 * } }
 */
let deliverooConfig = {};
client.onConfig((config) => {
    deliverooConfig = config;
    deliverooConfig.PARCEL_DECADING_INTERVAL = clockEventToMs(config.PARCEL_DECADING_INTERVAL);
});    



// ================== DASHBOARD SETUP ================== //

// Set up a single rider for the dashboard.
const dashboardRider = new Rider("_DASHBOARD_");
dashboardRider.client = client;

// Export globalPlan for planner use
let globalPlan = [];
export { globalPlan };

// Ensure the dashboard map is initialized when map data is received.
client.onMap((width, height, tiles) => {
    dashboard.initMap(width, height, tiles);
});

// Setup rider client
let PARCEL_DECAY = 1000;
client.onConfig((config) => {
    dashboardRider.setConfig(config);
    PARCEL_DECAY = config.PARCEL_DECADING_INTERVAL == "infinite" ? Infinity : config.PARCEL_DECADING_INTERVAL * 1000;
});
client.onYou(({ id, name, x, y, score }) => {
    if (!dashboardRider.player_init) {
        dashboardRider.init(id, name, new Position(x, y));
        dashboardRider.player_init = true;
        dashboardRider.trg.set(dashboardRider.position);
    } else {
        dashboardRider.updatePosition(x, y);
    }
});

export const riders = [];
riders.push(dashboardRider);


// FAST AGENT ======================================================================== //
const fastAgent = {
    client: client,
    searchFunction: aStarSearch,
    me: me,
    parcels: parcels,
    agents: agents,
    sensingEmitter: sensingEmitter,
    riders: riders,
    map: map,
    myIslandMap: myIslandMap,
    mapStats: mapStats,
    tilesHeatmap: tilesHeatmap,
    globalPlan: globalPlan,
    buddyId: args['buddyId'],
    MOVEMENT_DURATION: () => deliverooConfig.MOVEMENT_DURATION,
    PARCEL_DECADING_INTERVAL: () => deliverooConfig.PARCEL_DECADING_INTERVAL,
    PARCELS_OBSERVATION_DISTANCE: () => deliverooConfig.PARCELS_OBSERVATION_DISTANCE,
};

// Instantiate the dashboard.
const dashboard = new DemoDashboard(fastAgent, args['port']);
dashboard.start();

// START SENSING WITH BELIEF REVISION ================== //
const beliefRevision = new BeliefRevision(fastAgent);
beliefRevision.startSensing();

// START THE PLANNER LOOP ================== //
// Create a planner instance using the agent as the parent context.
const planner = new IntentionRevision(fastAgent);
planner.loop();

