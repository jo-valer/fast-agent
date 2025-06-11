import { Position } from "./position.js";

export const ActionType = Object.freeze({
  MOVE: "🔀 move",
  PICKUP: "🟡 pick_up",
  PUTDOWN: "🟢 put_down",
  WAIT: "wait",
});

/**
 * Represents an action that the agent can take
 *
 * @param {Position} source source position
 * @param {Position} target target position
 * @param {ActionType} type action type
 * @param {Parcel} action_parcel parcel to pick up
 */
export class Action {
  constructor(source, target, type, action_parcel) {
    this.source = source;
    this.target = target;
    this.type = type;
    this.action_parcel = action_parcel;

    // console.log("Action created: ", source, target);
  }

  /**
   * Returns a sequence of actions given a sequence of positions,
   * the type of action and the eventual parcel to pick up
   *
   * @param {Array} path sequence of positions
   * @param {ActionType} type type of action
   * @param {Map} action_parcel parcel to pick up
   *
   * @returns {Array} sequence of actions
   */
  static pathToAction(path, type, action_parcel) {
    // console.log("path: ", path);
    const actions = [];
    const lastPosition = new Position();

    if (path.length == 1) {
      lastPosition.x = Position.deserialize(path[0]).x;
      lastPosition.y = Position.deserialize(path[0]).y;
    } else {
      for (let i = 0; i < path.length - 1; i++) {
        const current = Position.deserialize(path[i]);
        const next = Position.deserialize(path[i + 1]);
        if (current.x === next.x) {
          if (current.y < next.y) {
            actions.push(new Action(current, next, ActionType.MOVE, null));
          } else {
            actions.push(new Action(current, next, ActionType.MOVE, null));
          }
        } else {
          if (current.x < next.x) {
            actions.push(new Action(current, next, ActionType.MOVE, null));
          } else {
            actions.push(new Action(current, next, ActionType.MOVE, null));
          }
        }
        lastPosition.x = next.x;
        lastPosition.y = next.y;
      }
    }

    if (type === ActionType.PICKUP) {
      actions.push(
        new Action(lastPosition, lastPosition, ActionType.PICKUP, action_parcel)
      );
    } else if (type === ActionType.PUTDOWN) {
      actions.push(
        new Action(lastPosition, lastPosition, ActionType.PUTDOWN, null)
      );
    } else {
      actions.push(
        new Action(lastPosition, lastPosition, ActionType.MOVE, null)
      );
    }
    return actions;
  }

  /**
   * Prints the action
   */
  printAction() {
    if (this.source == undefined || this.target == undefined) {
      console.log("⚠️ undefined action");
    }
    if (this.action_parcel != null) {
      console.log(
        "\t",
        this.type,
        " from ",
        this.source,
        " to ",
        this.target,
        " -> ",
        this.action_parcel
      );
    } else {
      console.log("\t", this.type, " from ", this.source, " to ", this.target);
    }
  }
}
