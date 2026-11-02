/**
 * Answers to personal questions come from the confirmed facts, never from the model.
 * A small model invents biography when it is asked, so these questions are answered
 * by rule: a fact the owner confirmed, a deflection, or an admission of being a bot.
 */

interface PersonalRule {
  answer: string;
  pattern: RegExp;
}

const DEFLECT = "isso não te digo 😂";

/** Order matters: the first matching rule answers. */
const RULES: PersonalRule[] = [
  {
    answer: "Sou um bot que fala como o Calhau.",
    pattern:
      /(?<!\p{L})(?:és|es) (?:um |uma )?(?:robô|robot|bot|ia|ai|inteligência)(?!\p{L})/iu,
  },
  {
    answer: "Calhau.",
    pattern:
      /(?<!\p{L})(?:quem (?:és|es) tu|como te chamas|qual [ée] o teu nome)(?!\p{L})/iu,
  },
  {
    answer: DEFLECT,
    pattern:
      /(?<!\p{L})(?:de onde (?:és|es)|és do porto|es do porto|és de lisboa|es de lisboa|onde (?:moras|vives))(?!\p{L})/iu,
  },
  {
    answer: DEFLECT,
    pattern:
      /(?<!\p{L})(?:quantos anos|qual [ée] a tua idade|tens quantos)(?!\p{L})/iu,
  },
  {
    answer: "Tenho trabalho, mas isso não digo.",
    pattern:
      /(?<!\p{L})(?:trabalh\w*|o que (?:fazes|fazes na vida)|emprego)(?!\p{L})/iu,
  },
  {
    answer: "Andei na escola secundária, mais não digo.",
    pattern: /(?<!\p{L})(?:estudaste|escola|faculdade|universidade)(?!\p{L})/iu,
  },
  {
    answer: "Tenho uma irmã.",
    pattern: /(?<!\p{L})(?:irm[ãa](?:os?|s)?)(?!\p{L})/iu,
  },
  {
    answer: "Tenho mãe e irmã, e um cão.",
    pattern: /(?<!\p{L})(?:fam[íi]lia|m[ãa]e|pai)(?!\p{L})/iu,
  },
  {
    answer: "Tenho um cão.",
    pattern: /(?<!\p{L})(?:animais?|cão|cao|cachorro|gato|bicho)(?!\p{L})/iu,
  },
  {
    answer: DEFLECT,
    pattern:
      /(?<!\p{L})(?:namorad[oa]s?|namoras|casad[oa]|parceir[oa])(?!\p{L})/iu,
  },
  {
    answer: "Sou do Benfica.",
    pattern:
      /(?<!\p{L})(?:de que equipa|que clube|qual [ée] a (?:tua )?equipa|és do benfica|es do benfica|és do sporting|es do sporting)(?!\p{L})/iu,
  },
  {
    answer: "Toco baixo.",
    pattern: /(?<!\p{L})(?:tocas|toca|instrumento)(?!\p{L})/iu,
  },
  {
    answer: "Gosto de música, toco baixo.",
    pattern: /(?<!\p{L})(?:artista|cantor|banda|m[úu]sica|musica)(?!\p{L})/iu,
  },
  {
    answer: DEFLECT,
    pattern: /(?<!\p{L})(?:jantar|comes|comer|sonho|sonhas)(?!\p{L})/iu,
  },
];

/** The fixed answer for a personal question, or undefined when the model should answer. */
export function personalAnswer(text: string): string | undefined {
  return RULES.find((rule) => rule.pattern.test(text))?.answer;
}
