/** One line of writing: the Bangla, which is the original and what the voices read, and its English. */
export type Line = readonly [bn: string, en: string];

/** A short back and forth. "o" is the other person, "h" is the hero. */
export type Scene = readonly (readonly ["o" | "h", Line])[];

/** A small job someone asks of the hero. The kind says how the game plays it out. */
export interface Favour {
  /** carry: take something to a place nearby. message: go and tell someone nearby. find: look around for a lost thing nearby. */
  kind: "carry" | "message" | "find";
  ask: Line;
  /** What the hero is told to do, short enough for the objective line: "Take the bag to the marked spot". */
  goal: Line;
  /** Said when it's done. */
  done: Line;
}

/** Everything one kind of person can say in conversation. None of it names how they address the
 *  hero, since the hero may be a young man, a woman, an old man or a child. */
export interface RoleTalk {
  greetStranger: Line[];
  greetKnown: Line[];
  greetLiked: Line[];
  greetDisliked: Line[];
  family: Line[];
  money: Line[];
  city: Line[];
  food: Line[];
  hot: Line[];
  rain: Line[];
  night: Line[];
  joke: Line[];
  advice: Line[];
  scamStory: Line[];
  gossip: Line[];
  dream: Line[];
  complaint: Line[];
  praised: Line[];
  insulted: Line[];
  apologyAccepted: Line[];
  thanked: Line[];
  giftTaken: Line[];
  refuse: Line[];
  bye: Line[];
  favours: Favour[];
}

/** What a choice leads to. */
export interface Outcome {
  /** Pocket money gained, or lost if negative. */
  money?: number;
  /** Mobile-money balance gained, or lost if negative. */
  mobile?: number;
  /** Standing with people in general. */
  rep?: number;
  /** A scam that comes back later: the key of another entry to fire in a while. */
  later?: string;
  /** Scam sense gained for spotting or learning from something. */
  sense?: number;
  /** What the player sees afterwards: what just happened and why. */
  lesson?: Line;
}

export interface TreeOption {
  text: Line;
  /** The next node, or none to end here. */
  go?: string;
  out?: Outcome;
}

export interface TreeNode {
  /** "o" the other person, "h" the hero. A node with options shows them after this line. */
  who: "o" | "h";
  say: Line;
  next?: string;
  options?: TreeOption[];
  out?: Outcome;
}

/** A small branching exchange: a phone call, a message, or somebody in the street. "start" comes first. */
export interface Tree {
  key: string;
  nodes: Record<string, TreeNode>;
}

/** A scam arriving on the phone or in person. */
export interface Scam extends Tree {
  kind: "call" | "sms" | "stranger";
  /** Who it claims to be, shown on the phone: "Bank Help Desk" or a number made of digits. */
  from: Line;
  /** For a message: the text of it. May contain digits, links and so on, since it's read rather than spoken. */
  body?: Line;
  /** Is this actually a scam? A few real messages are mixed in, so that not everything is suspect. */
  real?: boolean;
  /** Only ever fires as the follow-up to something else. */
  followUp?: boolean;
}

export interface FriendDef {
  key: string;
  name: Line;
  /** Which fruit they are, from the game's cast. */
  id: string;
  region: "dhaka_mirpur10" | "dhaka_gulshan" | "dhaka_dhanmondi";
  /** The kind of place they're found: where the game puts them to be met. */
  hangout: "tea" | "market" | "park" | "terminal" | "school" | "lake";
  bio: Line;
  firstMeet: Scene;
  smallTalk: Line[];
  /** Sitting down over tea together: each is one conversation. */
  teaTalks: Scene[];
  callHello: Line[];
  callBusy: Line[];
  callYes: Line[];
  /** They ring the hero. */
  theyCall: Tree[];
  favours: Favour[];
  closer: Line[];
  hurt: Line[];
  gift: Line[];
}

/** A random thing that happens in the street. */
export interface StreetEvent extends Tree {
  /** Who it happens with, from the game's cast. */
  id: string;
  /** The hint shown when the hero is close: "Someone's bag has burst". */
  hint: Line;
  /** Where it can happen. */
  place: "footpath" | "road" | "market" | "busstop" | "park";
}

export interface Book {
  key: string;
  title: Line;
  pages: Line[];
  /** Reading it to the end gives this much scam sense. */
  sense?: number;
}

export interface NewsItem {
  head: Line;
  body: Line;
}

export interface QuizQuestion {
  q: Line;
  options: Line[];
  /** Which option is right. */
  right: number;
}
