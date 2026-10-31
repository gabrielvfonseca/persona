const PATTERN_1 = /^[^:]{1,20}:\s*/u;
const PATTERN_2 = /[^.!?]*[.!?]/u;
export type ReplyTransform = (s: string) => string;
export type ReplyGuard = (s: string, ctx: { examples: string[] }) => boolean;

export const stripSpeakerPrefix: ReplyTransform = (s) =>
  s.replace(PATTERN_1, "");
export const firstSentence: ReplyTransform = (s) => {
  const m = s.match(PATTERN_2);
  return (m ? m[0] : s).trim();
};
export const noEcho: ReplyGuard = (s, ctx) =>
  !ctx.examples.some((e) => e.length >= 20 && s.includes(e));
export const notEmpty: ReplyGuard = (s) => s.trim().length > 0;
