import type { Text } from './i18n'

// Shape of a "?" guide step (engine: Guide.tsx, data: guides.ts and guides.*.ts).
//  target  data-guide="<target>" element to ring; the rest of the page is masked, with a hole over it. No target = no mask.
//  act     "Try it": the step moves on by itself when the person clicks the ringed element.
//  sample  shown in the panel as "Example" when the target is not on screen (an empty list: no open asks, no stale costs yet).
export interface GuideSample { title: Text; lines: Text[] }
export interface GuideStep { text: Text; target?: string; act?: boolean; sample?: GuideSample }
export interface Guide { title: Text; steps: GuideStep[] }

export const S = (en: string, ms: string, zh: string, ta: string, target?: string, extra?: Pick<GuideStep, 'act' | 'sample'>): GuideStep =>
  ({ text: { en, ms, zh, ta }, ...(target ? { target } : {}), ...extra })

/** Sample card: one title and a few lines, each given as [en, ms, zh, ta]. */
export const X = (title: [string, string, string, string], ...lines: [string, string, string, string][]): GuideSample => {
  const tx = ([en, ms, zh, ta]: [string, string, string, string]): Text => ({ en, ms, zh, ta })
  return { title: tx(title), lines: lines.map(tx) }
}
