export const Direction = Object.freeze({
    UP: "up",
    DOWN: "down",
    LEFT: "left",
    RIGHT: "right",
    NONE: "none",
  });
  
  /**
   * Represents a position in the grid
   *
   * @param {number} x x coordinate
   * @param {number} y y coordinate
   */
  export class Position {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  
    /**
     * Returns the position that results from moving in a given direction
     *
     * @param {Direction} direction direction to move
     *
     * @returns {Position} new position
     */
    moveTo(direction) {
      switch (direction) {
        case Direction.UP:
          return new Position(this.x, this.y + 1);
        case Direction.DOWN:
          return new Position(this.x, this.y - 1);
        case Direction.LEFT:
          return new Position(this.x - 1, this.y);
        case Direction.RIGHT:
          return new Position(this.x + 1, this.y);
        case Direction.NONE:
          return new Position(this.x, this.y);
        default:
          throw new Error(`err: ${direction}`);
      }
    }
  
    /**
     * Checks if two positions are equal
     *
     * @param {Position} other other position
     *
     * @returns {boolean} true if the positions are equal, false otherwise
     */
    equals(other) {
      return this.x === other.x && this.y === other.y;
    }
  
    /**
     * Sets the position to the values of another position
     *
     * @param {Position} pos other position
     */
    set(pos) {
      this.x = pos.x;
      this.y = pos.y;
    }
  
    /**
     * Returns the direction from a source position to a target position
     *
     * @param {Position} source source position
     * @param {Position} target target position
     *
     * @returns {Direction} direction
     */
    static getDirectionTo(source, target) {
      if (source.x < target.x) {
        return Direction.RIGHT;
      } else if (source.x > target.x) {
        return Direction.LEFT;
      } else if (source.y < target.y) {
        return Direction.UP;
      } else if (source.y > target.y) {
        return Direction.DOWN;
      } else {
        return Direction.NONE;
      }
    }
  
    /**
     * Returns a string representation of a position
     *
     * @param {Position} pos position to serialize
     *
     * @returns {string} string representation of the position
     */
    static serialize(pos) {
      return `${pos.x}-${pos.y}`;
    }
  
    /**
     * Returns a position from a string
     *
     * @param {string} str string representation of the position
     *
     * @returns {Position} position
     */
    static deserialize(str) {
      // console.log("str", str);
      const [x, y] = str.split("-");
      return new Position(Number(x), Number(y));
    }
  }
  