<a id="WORK-00215" data-uid="rmnbc8mpuovg"></a>

<a id="WORK-00216" data-uid="tn7vxepzpdvc"></a>
# Dual Documentation

<a id="WORK-00217" data-uid="uc69rrsyy8pu"></a>
## Basic Idea

* Spec documents fall into two categories:
    1. Baseline specs for the whole system as intended
    2. Change specs for changes in functionality
* After changes to incremental specs, Specquer automates (with AI)
  the corresponding changes to anchored specs.

<a id="WORK-00218" data-uid="apie9mkcbau9"></a>
## WIP Ideas

* Folder settings let you choose the folder type (formerly sectioned - yes/no):
  - Anchored Specs
  - Incremental Specs
  - Auxiliary Specs
  - Non-sectioned Documents
* TBD: Right-click or some mechanism to update all anchored specs from the
  content of an incremental spec.

<a id="WORK-00219" data-uid="grnu4l80atwn"></a>
## TBD

<a id="WORK-00220" data-uid="le519atyazh1"></a>
### Grounding

* This repository already works this way: `documentation/specifications/` is the
  whole system as intended, and each `documentation/work-items/step-00N/` is an
  incremental spec. The step plans have a "Precedence" table and a documentation
  phase listing the specifications to update, which is done by hand today.
* First acceptance test: given only the Step 006 requirements and plan, could
  Specquer produce the spec changes made by hand for Step 006 (client requirements
  §3.6 and §10, server requirements §9, data architecture §2.3 and §4.2, security)?

<a id="WORK-00221" data-uid="gqo40upx1diy"></a>
### Concept

* Naming: "anchored" collides with section anchors, which every sectioned document
  has, incremental ones included. Alternatives: "system" or "baseline" specs for the
  whole system, "change" specs or work items for the increments.
* Define "Auxiliary Specs": notes and references (glossary, ideas)? Read by the
  update as context but never edited?
* The folder type replaces Step 006's Sectioned Yes/No. The prefix configuration needs
  to carry it, e.g. `"documentation/specifications/": { prefix: SPEC, type: system }`,
  with plain `SPEC` and `null` still valid. The type is inherited like the prefix;
  single-file keys (`glossary.md` → `DEFN`) need one too. Non-sectioned is today's
  `null`; the three other types need a prefix.

<a id="WORK-00222" data-uid="o3kb9tb107wk"></a>
### Update Mechanism

* Propose, don't apply: the AI produces one diff per affected spec file, reviewed and
  accepted or rejected hunk by hunk (CodeMirror's merge view) before anything is
  written. Anchors change files only when the user does (Security §8).
* Section anchors: the model must move anchors with their sections, write
  `<a id=""></a>` for new sections, and never invent or copy IDs (the `AGENTS.md`
  rules). Check each proposal against the section index rather than trusting the
  prompt; reject or flag invented or copied IDs.
* Deleting a section retires its ID and breaks links to it. Proposals that remove
  sections say so, listing the incoming links that would break.
* Traceability: incremental specs name the sections they change by link
  (`client-requirements.md#SPEC-00043`). After an update, record which incremental
  spec changed which sections, giving a per-section "changed by" history and making a
  second application of the same spec detectable.
* Lifecycle: a status for incremental specs (draft, approved, applied), perhaps in
  front matter; several are applied in order. Implementation status sections record
  how the build deviated from the plan, and those deviations belong in the anchored
  specs too.
* Context size: the anchored specs exceed one call's budget. Use the Step 004/005
  summaries and the lookup by section ID to choose the relevant sections, and send only
  those in full.
* Model: multi-file editing needs a stronger model than `gemma-4-31b-it` (about 55 s a
  call on the free tier): the two tiers of models deferred in Step 005.
* Privacy: like pre-filling, this sends whole specs to the provider; the same opt-in
  and warning apply.
* Safety: an update across many files requires the anchored specs to be saved, and
  ideally committed, so Git is the undo.

<a id="WORK-00223" data-uid="amzsvj416w7c"></a>
### First-Cut Scope

* In: triggered by hand on one incremental spec ("Update anchored specs from
  this..."); a proposal per affected file, with anchors checked; reviewed in a diff,
  then applied.
* Out for now: running automatically, applying several incremental specs together, a
  status workflow.

<a id="WORK-00224" data-uid="mqm7h18dijr4"></a>
### Open Questions

* Does an incremental spec describe the change ("add a gear button"), or hold the new
  text? The first needs the model to rewrite the specs; the second is closer to a merge.
* Which wins when an anchored spec was edited by hand after the incremental spec was
  written?
* Do the step plans' "Precedence" tables become a structured format the update reads,
  or stay prose?
