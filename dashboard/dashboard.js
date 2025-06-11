// demo_dashboard.js
import { MyServer } from "./server.js";
import { Field } from "./data/field.js";
import { Position } from "./data/position.js";
import { ActionType } from "./data/action.js";

export class DemoDashboard {
  constructor(agent, port=3001) {
    this.agent = agent;
    this.PORT = port;
    this.server = new MyServer(this.PORT);
    this.dashboardMap = new Field();
    this.mapInitialized = false;
  }

  // Called when the map is first received.
  initMap(width, height, tiles) {
    if (!this.mapInitialized) {
      this.dashboardMap.init(width, height, tiles);
      this.mapInitialized = true;
    }
  }

  start() {
    setInterval(() => {
      const update_map = this.dashboardMap.getMap();
      const riders_data = [];

      // Organize rider data for the dashboard.
      this.agent.riders.forEach(rider => {
        if (rider.player_init) {
          let plan_move = [];
          let plan_pickup = [];
          let plan_drop = [];
          let rider_parcels = [];
          if (rider.plan && rider.plan.length > 0) {
            for (const p of rider.plan) {
              const move_id = Position.serialize(p.source);
              switch (p.type) {
                case ActionType.MOVE:
                  plan_move.push(move_id);
                  break;
                case ActionType.PICKUP:
                  plan_pickup.push(move_id);
                  break;
                case ActionType.PUTDOWN:
                  plan_drop.push(move_id);
                  break;
              }
            }
          }
          if (rider.player_parcels && rider.player_parcels.size > 0) {
            for (const [key, p] of rider.player_parcels.entries()) {
              rider_parcels.push({ key: key, reward: p });
            }
          }
          let blk_agents = [];
          if (rider.blocking_agents) {
            for (const blk of rider.blocking_agents.values()) {
              blk_agents.push(blk.x + "-" + blk.y);
            }
          }
          riders_data.push({
            x: rider.position.x,
            y: rider.position.y,
            plan: [plan_move, plan_pickup, plan_drop],
            parcels: rider_parcels,
            blk_agents: blk_agents,
          });
        }
      });

      // Organize parcels data for the dashboard.
      const dash_parcels = [];
      this.agent.parcels.forEach(p => {
        dash_parcels.push({ x: p.x, y: p.y, reward: p.reward });
      });

      const dash_data = {
        map_size: [this.dashboardMap.width, this.dashboardMap.height],
        tiles: update_map,
        riders: riders_data,
        parc: dash_parcels,
      };

      this.server.emitMessage("map", dash_data);
    }, 100);
  }
}
