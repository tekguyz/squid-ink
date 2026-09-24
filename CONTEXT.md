# Squid Ink

A bot-free AI meeting notepad. It records a meeting on the user's own device, transcribes it, and turns the transcript into a structured note the user can question.

This file is a glossary and nothing else. Seeded 2026-09-24 with terms already settled in `docs/DECISIONS.md`; `/grill-with-docs` adds to it as new terms resolve.

## Language

### Notes

**Note**:
One recorded meeting and everything generated from it: its recording, transcript, summary, takeaways and action items.
_Avoid_: Meeting, session, document

**Recording**:
The audio captured for one note, from the system, the mic, or both.
_Avoid_: Clip, file

**Transcript**:
The text of a recording, split into segments.

**Segment**:
One span of the transcript, with a start time and, when labels exist, a speaker.
_Avoid_: Line, utterance

**Speaker label**:
The name attached to a segment. Long recordings are transcribed without them.
_Avoid_: Diarization (in user-facing copy)

**Summary**:
The prose overview of a note.

**Takeaway**:
One numbered point the note's persona draws from the meeting.
_Avoid_: Insight, highlight

**Action item**:
A task that came out of the meeting, with an owner and a due date when known.
_Avoid_: Task, to-do

**Citation**:
A link from a claim in a note back to the segment it came from. Shown as a citation chip.
_Avoid_: Source, reference

**Chunk**:
One stored piece of a note (a summary, takeaway, action item or segment) that chat can retrieve.

### Personas

**Persona**:
A named preset that decides how a note is generated. It bundles a lens, a depth and its quick actions.
_Avoid_: Template, recipe, mode

**Lens**:
Whose expertise frames the analysis, such as Sales Coach or Neutral Analyst.
_Avoid_: Role, perspective

**Depth**:
How much analytical work generation does: Brief, Dense or Exhaustive. Depth changes scope, not only length.
_Avoid_: Detail level, goal

**Default persona**:
Neutral Analyst, one fixed persona for everyone. It is not a per-account preference.

**Quick action**:
A persona's one-tap draft of a follow-up, such as a client email or a Jira ticket.
_Avoid_: Recipe

### Organising

**Collection**:
A named group of notes, filled by hand or by rules.
_Avoid_: Folder, project

**Rule**:
A condition that files matching notes into a collection, either straight away or into needs-review.

**Needs-review**:
Notes a rule matched but did not file, waiting for the user to confirm.

**Tag**:
A short label on a note, separate from collections.

### Product

**Surface**:
One screen of the design reference, numbered 01 to 10.
_Avoid_: Page, view

**Demo mode**:
A signed-in-anonymously tour of sample notes, with no live recording.
