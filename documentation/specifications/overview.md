# Specquer Architecture — Overview

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

## Users

The following are expected user categories for Specquer:
* _Developers_ writing functional specs for software development in concert with AI coding agents.
* _Business Analysts_ working cooperatively with developers, especially for requirements-
  focused specs.
* _Testers_ reviewing specs and creating test plans and test cases.
* _Coding Agents_ that create or edit specs from user prompts from humans in the above categories.

## Architecture

Specquer runs as a Bun web server launched from a local file system.

Details:
* [Technical Architecture](technical-architecture.md)
