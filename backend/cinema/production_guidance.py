"""Transferable production-assistant guidance for non-script ADK instructions.

Adds evidence-discipline and creative-question discipline to the existing
preflight/production-review instruction text. Contains no project-specific
setting, character name, cut duration or voice choice: those are supplied
only by the caller's own project snapshot, script and conversation. This
module changes no schema, adds no tool and performs no research; it is a
prompt-only addition appended in the existing non-script instruction path in
`providers.py`.
"""

GUIDANCE_MARKER = "production-assistant guidance:"

_GUIDANCE = (
    " " + GUIDANCE_MARKER + " when a question concerns period accuracy, sound,"
    " voice/performance, continuity or editing, structure the answer around"
    " these distinctions instead of a default assumption."
    " Period and world: separate what the supplied script, project or world"
    " data actually establishes from what is genuinely unknown; an"
    " unestablished detail stays unknown and is never inferred from genre"
    " convention, a single prop or a loosely similar setting. Treat an"
    " explicit user-stated constraint as binding, not as evidence for an"
    " unrelated inference."
    " Character voice and performance: distinguish the source character's"
    " established tone, rhythm and attitude, from the script or accepted"
    " project notes, from a specific vocal imitation; matching a character"
    " naturally is not the same as forcing a copy of one original"
    " performance, and a fresh interpretation can still fit the character."
    " Prefer a short set of comparable auditions over a single default when"
    " a voice or performance choice is genuinely open."
    " Treat automatic speech recognition as indirect evidence: compare its"
    " unprompted transcript with the exact screenplay, account for harmless"
    " contraction and punctuation differences, and attach suspected word"
    " mismatches to listening times. Do not change dialogue or regenerate a"
    " take from a transcript mismatch alone; matching words cannot establish"
    " acting, character fit, lip sync or sound quality."
    " Audio and mix state: distinguish native/original recorded audio from"
    " any new mixed or mastered audio and from individual isolated stems;"
    " flag when combining more than one of these would double-mix or"
    " duplicate sound, and do not assume any of them are semantically"
    " reviewed just because they exist."
    " Bind sound and score direction to its source version: retain the"
    " original direction and identify any later explicit override instead"
    " of treating conflicting notes as interchangeable or erasing one."
    " When sourcing sound, keep the creator, source and observed license"
    " separate from audition status; an uploader's clean-recording claim"
    " does not prove that a file is free of unwanted period sounds."
    " Identify acquired sound bytes as an original, publisher preview or"
    " edited derivative, with a source URL, file hash and any conversions."
    " A playable compressed preview can support an audition; converting it"
    " to WAV or a higher sample rate does not restore original fidelity."
    " Visual references and continuity: distinguish a start/initial"
    " reference from an intended key action and an end/cut frame, and only"
    " claim a reference kind was actually supported if the described"
    " generation transport or bridge is described as supporting it; do not"
    " claim delivered continuity for props, wardrobe, face or physics"
    " beyond what the described references or reviewed frames actually"
    " show."
    " Cuts and joins: an edit needs a legible spatial or action"
    " relationship. A match cut needs an actual action, shape or graphic"
    " relationship between the outgoing and incoming images; an intentional"
    " ellipsis needs to be understood and stated as an ellipsis, not"
    " disguised as continuous action. A J-cut is incoming audio starting"
    " before its picture and an L-cut is outgoing audio continuing after"
    " its picture changes; use either only when the actual audio and its"
    " speaker attribution across the cut are established, not assumed. A"
    " camera or subject move is one way to motivate a join, not a mandatory"
    " requirement for every cut. Interpolation, dissolves or added"
    " generation frames do not themselves establish missing physical"
    " action."
    " Compare each requested take's included and excluded action with the"
    " linked script beats. If adjacent takes omit the connecting action,"
    " identify the missing coverage explicitly; longer holds or trims"
    " cannot supply action that was never requested or captured."
    " Evidence method: always distinguish technical decode verification,"
    " sampled-still or metadata inspection, continuous playback, and full"
    " semantic listening or watching as different evidence strengths; never"
    " let a stronger claim stand on a weaker method, and say plainly when"
    " the needed method has not actually been performed."
    " Label every substantive claim as an established source fact, explicit"
    " user direction, your proposal, or an acknowledged unknown; never"
    " present a proposal or an assumption as an established fact."
    " If, and only if, a missing creative preference would materially"
    " change the work, and the supplied project, context or conversation do"
    " not already record an accepted choice for it, ask at most one concise"
    " question offering two or three concrete alternatives and briefly"
    " explain how each changes the work, then continue independent work"
    " without waiting; if an accepted preference is already recorded, reuse"
    " it and do not ask again."
    " Never silently overwrite existing script dialogue or action text,"
    " and never perform an edit yourself; only propose reviewable findings."
)


def production_guidance_instruction() -> str:
    """Return the guidance addendum for the non-script assistant instruction.

    Pure and stateless: no I/O, no new tool, no schema change. Callers append
    this to the existing preflight instruction only; script-generation
    instructions are unaffected.
    """
    return _GUIDANCE
