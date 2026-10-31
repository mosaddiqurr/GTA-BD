import { bn } from "../localization/bn";

/** What the phone remembers, kept with the saved game. */
export interface PhoneData {
  mobile: number;
  pin: string | null;
  statement: { text: string; amount: number; hour: number }[];
  threads: { who: string; read: boolean; last: number; msgs: { mine: boolean; text: string }[] }[];
  calls: { who: string; kind: "in" | "out" | "missed"; hour: number }[];
  jobs: { id: string; title: string; from: string; text: string; done: boolean }[];
  missed: number;
  welcomed: boolean;
}

export function freshPhone(): PhoneData {
  return { mobile: 1500, pin: null, statement: [], threads: [], calls: [], jobs: [], missed: 0, welcomed: false };
}

export interface Contact {
  id: string;
  name: string;
  about: string;
  number: string;
  /** Which of the cast's voices they speak with. */
  voice: string;
  /** Something that can be sent money. */
  bank?: boolean;
  /** Never in the contact list: numbers that only ever ring you. */
  hidden?: boolean;
  /** What's said when the hero rings: them first, then turn about. */
  calls: readonly (readonly string[])[];
  /** What's said when they ring. */
  incoming?: readonly (readonly string[])[];
  replies?: readonly string[];
}

const p = bn.phone.people;
export const CONTACTS: Contact[] = [
  { id: "chacha", name: p.chacha.name, about: p.chacha.about, number: "০১৭০০-০০০০০১", voice: "npc_elder_date", bank: true, calls: p.chacha.calls, incoming: p.chacha.incoming, replies: p.chacha.replies },
  { id: "rasel", name: p.rasel.name, about: p.rasel.about, number: "০১৭০০-০০০০০২", voice: "npc_student_lemon", bank: true, calls: p.rasel.calls, incoming: p.rasel.incoming, replies: p.rasel.replies },
  { id: "tanvir", name: p.tanvir.name, about: p.tanvir.about, number: "০১৭০০-০০০০০৩", voice: "npc_office_orange", bank: true, calls: p.tanvir.calls, incoming: p.tanvir.incoming, replies: p.tanvir.replies },
  { id: "landlord", name: p.landlord.name, about: p.landlord.about, number: "০১৭০০-০০০০০৪", voice: "npc_worker_jackfruit", bank: true, calls: p.landlord.calls, incoming: p.landlord.incoming, replies: p.landlord.replies },
  { id: "emergency", name: p.emergency.name, about: p.emergency.about, number: "৯৯৯", voice: "npc_office_orange", calls: p.emergency.calls },
  { id: "bank", name: p.bank.name, about: p.bank.about, number: "১৬০০০", voice: "npc_office_orange", hidden: true, calls: p.bank.calls },
  { id: "unknown", name: p.unknown.name, about: "", number: "০১৩০০-০০০০০০", voice: "npc_commuter_lychee", hidden: true, calls: p.unknown.calls, incoming: p.unknown.incoming },
];
