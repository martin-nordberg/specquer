<a id="SPEC-00057" data-uid="gnv4h0oi8xrd"></a>

<a id="SPEC-00058" data-uid="lm9qeggt0uj9"></a>
# Specquer Architecture — Overview

<a id="SPEC-00059" data-uid="txeqm4i8rcgi"></a>
## Application Purpose

* Specquer is a software development tool for viewing, reviewing, and summarizing software
  specifications written in Markdown.
* Specquer adds to the base functionality of typical Markdown editors the following features:
    - AI-generated summarization of collapsible/expandable sections (by heading).
    - Semi-structured management of spec document sections and subsections.
    - Navigation among sections of interrelated spec documents in the sense of requirements traceability.
    - Automated synchronization of parallel specs with two different focuses:
        - specification of the intended overall state of a system, and
        - specification of incremental changes to the system - use cases/stories/tasks/units of work.

<a id="SPEC-00060" data-uid="vag98ceqt5ej"></a>
## Users

The following are expected user categories for Specquer:
* _Developers_ writing functional specs for software development in concert with AI coding agents.
* _Business Analysts_ working cooperatively with developers, especially for requirements-
  focused specs.
* _Testers_ reviewing specs and creating test plans and test cases.
* _Coding Agents_ that create or edit specs from user prompts from humans in the above categories.

<a id="SPEC-00061" data-uid="jzz3ij6qofw5"></a>
## Architecture

Specquer runs as a Bun web server launched from a local file system.

Details:
* [Technical Architecture](technical-architecture.md)
* [Information Architecture](info-architecture.md)
* [Client Requirements](client-requirements.md)
* [Server Requirements](server-requirements.md)
* [Security](security.md)
* [Data Architecture](data-architecture.md)
