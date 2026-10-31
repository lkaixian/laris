// A tiny message bus between the pages and the Ask Laris robot: where to stand, what to say, what it is doing. Nothing here touches data.
export type BotHole = { x: number; y: number; w: number; h: number }
export type BotMsg =
  | { kind: 'spot'; hole: BotHole; act?: boolean }   // a guide or tour step is pointing at this part of the screen: the robot stays in its corner
  | { kind: 'home' }                                  // back to the corner
  | { kind: 'state'; s: 'idle' | 'think' | 'talk' }   // the assistant is working out an answer / giving it
  | { kind: 'say'; text: string; ms?: number }        // a short speech bubble
export const BOT_EVENT = 'laris:bot'
export const bot = (m: BotMsg) => dispatchEvent(new CustomEvent<BotMsg>(BOT_EVENT, { detail: m }))
