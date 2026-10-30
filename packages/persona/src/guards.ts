export type ReplyTransform = (s: string) => string;
export type ReplyGuard = (s: string, ctx: { examples: string[] }) => boolean;

export const stripSpeakerPrefix: ReplyTransform = (s) =>
  s.replace(/^[^:]{1,20}:\s*/, "");
export const firstSentence: ReplyTransform = (s) => {
  const m = s.match(/[^.!?]*[.!?]/);
  return (m ? m[0] : s).trim();
};
export const noEcho: ReplyGuard = (s, ctx) =>
  !ctx.examples.some((e) => e.length >= 20 && s.includes(e));
export const notEmpty: ReplyGuard = (s) => s.trim().length > 0;
