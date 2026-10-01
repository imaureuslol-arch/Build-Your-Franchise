import { formatSalary } from "./types";
import type { Ask } from "./extensions";

export type ExtensionTier = "max" | "star" | "starter" | "rotation" | "bench" | "minimum";

/** Current fair value, in millions; a capped first-season ask takes priority. */
export function extensionTier(fairValue: number, ask: Ask, firstYear: number): ExtensionTier {
  if (ask.perYear[firstYear] === ask.max) return "max";
  if (fairValue >= 40) return "star";
  if (fairValue >= 20) return "starter";
  if (fairValue >= 10) return "rotation";
  if (fairValue >= 5) return "bench";
  return "minimum";
}

export const EXTENSION_DIALOGUE = {
  max: {
    opening: [
      "Look, you're paying me the max. Let's not waste time.",
      "We both know the number. Put down the max.",
      "My agent said this would be quick. Max deal, right?",
      "Aight. The max. What else is there to talk about?",
      "I'm not haggling over this. You know what I cost.",
      "Let's get this done. Max money. I got shootaround.",
    ],
    quote: ["The number's {ask}. Let's get it signed.", "{ask}. You knew that already."],
    accepted: ["Good. Let's get to work.", "There we go. Send the papers."],
    overpaid: ["Good. Let's get to work.", "There we go. Send the papers."],
    close: ["The max. Not almost the max.", "You're not actually trying to negotiate, right?"],
    low: ["Put down the max and let's get to work.", "We both know I'm getting the max. Try again."],
    insult: ["Is this a joke? Put down the max.", "Man, stop wasting my time. You know the number."],
    final: ["{ask}. Sign it or I'm hitting the market.", "Last time I'm saying it. {ask}."],
    declined: ["Aight. Someone else will pay me.", "Good luck replacing me."],
  },
  star: {
    opening: [
      "Aight I'm listening. Don't lowball me.",
      "Check the stats. Then give me the number.",
      "I like it here. But I'm getting paid either way.",
      "My agent said you'd be calling. What's the number?",
      "I've been doing my part. Now pay me.",
      "Straight up, I'm expecting a bag. What's the offer?",
    ],
    quote: ["I'm asking {ask}. Don't lowball me.", "{ask}. That's the number."],
    accepted: ["Alright, that's a fair deal. Let's do it.", "That's more like it. You got a deal."],
    overpaid: ["YOU SERIOUS?! Hell yeah! You got a deal!", "Aight, I'm signing that right now."],
    close: ["Give me a small bump and you've got a deal.", "We're close. I'm gonna need a little more."],
    low: ["This is a low-ball offer. I know what I'm worth.", "I like playing here, but I'm gonna need more."],
    insult: ["You're crazy man. This is disrespectful.", "Check the stats and try again. Seriously."],
    final: ["{ask}. Take it or I'm hitting the market.", "I'm done playing games. {ask}. Yes or no?"],
    declined: ["Don't call me when someone else pays me.", "Aight. I'll get my money somewhere else."],
  },
  starter: {
    opening: [
      "Look, I like it here. But this is business. What's the offer?",
      "I've been starting every night. Let's talk money.",
      "Been waiting on this. Let's hear it.",
      "I want to stay. Just give me a fair number.",
      "You know what I bring. What's the offer?",
      "Let's get this done. I got shootaround in an hour.",
    ],
    quote: ["I'm looking for {ask}. We can talk.", "{ask} and I'd like to stay."],
    accepted: ["Alright, let's do it.", "That's fair. I'm staying."],
    overpaid: ["Hell yeah. Where do I sign?", "You're serious? You got a deal."],
    close: ["We're close. Give me a little more.", "Small bump and I'll sign."],
    low: ["I play too much for that number.", "I want to stay, but I need more than that."],
    insult: ["Man, I'm starting for you. Be serious.", "That's not a real offer. Try again."],
    final: ["{ask} and I'll sign. Last offer.", "Look, I want to stay. {ask}. That's it."],
    declined: ["Alright. I'll see what's out there.", "That's that, then. Take care."],
  },
  rotation: {
    opening: [
      "I know my role. Just pay me fair.",
      "I like it here. Can we get a deal done?",
      "Coach trusts me. I'd like to stick around.",
      "Alright, let's talk. What's the offer?",
      "I'm not asking for star money. Just a fair deal.",
      "I did what coach asked. I'd like another deal.",
    ],
    quote: ["Could we do {ask}?", "I'm looking for {ask}. Nothing crazy."],
    accepted: ["Works for me. Let's do it.", "Alright, I'm happy with that."],
    overpaid: ["Damn. Yeah, I'll sign.", "That's more than I expected. Deal."],
    close: ["Could you come up a little?", "Almost there. Just a small bump."],
    low: ["I think I've earned a little more than that.", "Could you do better? I'd like to stay."],
    insult: ["I'm not asking for much, man. Come on.", "Even for my role, that's low."],
    final: ["Can we just do {ask} and get this signed?", "{ask}. That's what I need to stay."],
    declined: ["Alright. Thanks for the run.", "I'll see if someone needs me."],
  },
  bench: {
    opening: [
      "Hey boss. Still got a spot for me?",
      "I know I didn't play much. I'd like to stay though.",
      "Not asking for a bag. Just another deal.",
      "I'll be ready when coach calls. Can I stay?",
      "I like it here, man. What can you do?",
      "Just give me a number. I'll hear you out.",
    ],
    quote: ["I was hoping for {ask}. Can you do that?", "Could I get {ask}? I'd like to stay."],
    accepted: ["Thank you, boss. I'll be ready.", "Yeah, I'll take that. Thank you."],
    overpaid: ["For real? Man, thank you.", "Yeah! I'm signing that."],
    close: ["Any chance you could add a little?", "That's close. Could you do a bit more?"],
    low: ["I know I don't play much. Could you come up a bit?", "I'd like to stay. Just need a little more."],
    insult: ["Come on, boss. Even I need more than that.", "I know my role, but that's rough."],
    final: ["{ask} and I'll sign. Please.", "Can you do {ask}? I'd rather stay here."],
    declined: ["Damn. Alright, thanks anyway.", "If you need a bench guy later, you got my number."],
  },
  minimum: {
    opening: [
      "Boss, please. Just keep me on the roster.",
      "I know the stats aren't great. Give me another shot.",
      "I'm not asking for a bag. I just need a spot.",
      "Whatever you can do, boss. I want to stay.",
      "Please tell me you still got room for me.",
      "I'll sit, I'll practice, whatever. Just keep me here.",
    ],
    quote: ["Could I get {ask}? Please, boss.", "I was hoping for {ask}. I just want to stay."],
    accepted: ["Thank you. Seriously. I'll be ready.", "Yes. I'll take it. Thank you, boss."],
    overpaid: ["Wait, for me? Thank you, boss.", "Man, you just made my year. Yes."],
    close: ["Just a little more, boss. Please.", "Can you come up a tiny bit? I'll sign."],
    low: ["Please, boss. I need a bit more than that.", "I know I haven't done much. Just a little more?"],
    insult: ["Boss, come on. I can't take that.", "Please. I still gotta pay rent."],
    final: ["{ask}. Please, boss. I want to stay.", "Can you do {ask}? Please. I'll sign right now."],
    declined: ["Please call if a spot opens up.", "Damn. If you change your mind, I'm here."],
  },
} satisfies Record<ExtensionTier, Record<string, readonly string[]>>;

export function dialogueLine(tier: ExtensionTier, kind: keyof typeof EXTENSION_DIALOGUE.max, seed: number, ask?: string): string {
  const lines = EXTENSION_DIALOGUE[tier][kind];
  return lines[(seed >>> 0) % lines.length].replace("{ask}", ask ?? "");
}

export function finalDemandLine(tier: ExtensionTier, amount: number, seasons: number, seed: number): string {
  const ask = `${formatSalary(amount)} per year for ${seasons} ${seasons === 1 ? "year" : "years"}`;
  return dialogueLine(tier, "final", seed, ask);
}
