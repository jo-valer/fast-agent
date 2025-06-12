export const MAX_INT = 1000000; // Maximum integer value to use in the game (for example, for scores)

// STATS
export const TUNNEL_MIN_LENGTH = 2; // Minimum number of consecutive tiles with only two neighboring tiles to be considered a tunnel

// BEHAVIOR
export const MIN_STEPS_TO_UPDATE = 1; // Minimum distance traveled (in number of tiles) to send new position to the buddy
export const DELIVERY_TILE_SEARCH_FUNCTION = "auto"; // [auto, searchFunction, manhattan]  // Function to use for searching delivery tiles
export const PARCEL_SHARING = true; // If true, the agent will share the parcels beliefs with the buddy
export const OPPONENTS_SHARING = true; // If true, the agent will share the opponents beliefs with the buddy
export const USE_PDDL = false; // If true, the agent will use PDDL 
