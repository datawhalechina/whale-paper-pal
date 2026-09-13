---
name: whalepaper-paper-check
description: Audit the current LaTeX academic paper for concrete, verifiable errors. Use when the user asks to check a paper, manuscript, thesis, or LaTeX project for errors.
---

# Paper Error Check

Audit the current LaTeX project. This is a read-only review: do not edit,
create, delete, or reformat project files.

1. Inspect the project structure and read the manuscript source, included TeX
   files, bibliography, and relevant generated or experimental artifacts when
   they are present.
2. Report only specific, supportable findings. Prioritize mathematical errors,
   logical contradictions, technical inaccuracies, experimental or numerical
   inconsistencies, notation or definition errors, invalid causal claims, and
   citation or cross-reference mismatches.
3. Do not report subjective style preferences, generic requests for more
   experiments, vague writing advice, novelty assessments, or unverified
   external facts as errors.
4. Verify every candidate against the source before reporting it. If the
   source does not support the claim, omit it.
5. Return the results in Simplified Chinese. Begin with a short overall
   conclusion, then list findings ordered by severity. For every finding give:
   severity (`严重` or `一般`), category, exact `relative/path.tex:line`,
   source evidence, why it is a problem, and a concrete correction direction.
6. State clearly when no verifiable error was found, and mention any files or
   evidence that could not be checked.
