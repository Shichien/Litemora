# Agent System Context -- vite-threejs Framework Skills

> This document defines the **canonical Agent System design**,\
> **Skill indexing protocol**, and\
> **vite-threejs framework-level skill architecture**\
> for use by AI IDEs / LLM-based agents.

------------------------------------------------------------------------

## 1. High-Level Goal

We are building an **Agent System** for software development with the
following properties:

-   Routing-based (planner + dispatcher)
-   Skill-driven (capabilities are explicitly indexed)
-   Project-aware (context-sensitive, not generic)
-   Long-term maintainable (skills evolve, routing logic stays stable)

The system is designed primarily for: - Three.js-based applications -
Built on **vite + vue + pinia + tailwindcss** - Including (but not
limited to): - Third-person games - 3D scene editors - Interactive demos

------------------------------------------------------------------------

## 2. Core Concepts

### 2.1 Skill

A **Skill** is a declarative capability unit that: - Has a clearly
defined scope - Declares what problems it solves - Declares what it must
NOT do - Can be discovered by an Agent **without reading implementation
details**

> A Skill is discovered via `SKILL.md`.

------------------------------------------------------------------------

### 2.2 Index System vs Routing System

#### Index System

-   Purpose: **Capability discovery**
-   Answers: *"What skills exist, and what are they for?"*
-   Mechanism: scanning `SKILL.md` files only
-   Must be:
    -   Lightweight
    -   Structured
    -   Stable

#### Routing System

-   Purpose: **Decision making & task decomposition**
-   Answers: *"Which skills should be used for this task, and in what
    order?"*
-   Depends on:
    -   Task intent
    -   Project context
    -   Skill index (not full docs)

> **Index ≠ Routing, but Routing depends on Index.**

------------------------------------------------------------------------

## 3. Two Skill Layers

### 3.1 Framework Skills (vite-threejs)

Framework Skills define: - The *correct way* to build applications
inside the vite-threejs framework - Architectural constraints and
invariants - Long-lived, stable rules

They answer: \> "How should things be built in this framework?"

Examples: - Class-based 3D component model - Lifecycle management (init
/ update / dispose) - Three.js ↔ Vue integration rules - Pinia state
ownership - Input → Intent mapping - Rendering & performance constraints

Framework Skills **must not**: - Encode game logic - Encode specific
gameplay patterns - Depend on project-specific assumptions

------------------------------------------------------------------------

### 3.2 Application / Custom Skills

Application Skills define: - Context-specific behavior - Replaceable
strategies (FSM, ECS, physics engines, etc.)

They answer: \> "What are we building *this time*?"

They are: - Less stable - Strongly contextual - Built on top of
Framework Skills

------------------------------------------------------------------------

## 4. Skill Indexing Protocol (Critical)

### 4.1 `SKILL.md` is Mandatory

**Only `SKILL.md` is considered a valid skill index entry.**

-   README.md, FOUNDATION.md, or arbitrary markdown files\
    are **not** valid for routing or indexing.

> If a capability is not declared in `SKILL.md`,\
> the Agent must assume it does not exist.

------------------------------------------------------------------------

### 4.2 Progressive Disclosure

Each Skill uses **progressive disclosure**:

-   `SKILL.md` → discovery & routing
-   `references/*.md` → execution details

Agents must: 1. Read `SKILL.md` first 2. Decide relevance 3. Dive into
references only if needed

------------------------------------------------------------------------

## 5. vite-threejs as a Composite Skill

`vite-threejs` itself is treated as a **Composite Skill**.

It: - Has its own root `SKILL.md` - Governs a set of mandatory
sub-skills - Acts as the **framework contract**

------------------------------------------------------------------------

## 6. Canonical Directory Structure (Framework Skills)

``` text
skills/
└── vite-threejs/
    ├── SKILL.md
    ├── GENERATION.md
    ├── SYNC.md
    ├── conventions/
    ├── component-model/
    ├── lifecycle/
    ├── rendering/
    ├── scene-management/
    ├── resource-management/
    ├── state-management/
    ├── input-system/
    ├── camera-system/
    ├── animation-system/
    ├── physics-integration/
    ├── ui-integration/
    ├── performance/
    └── anti-patterns/
```

------------------------------------------------------------------------

## 7. SKILL.md Frontmatter Schema (Recommended)

``` yaml
name: component-model
layer: framework
framework: vite-threejs
type: atomic | composite
stability: high | medium | low
risk-level: low | medium | high
touches-config: true | false
```

------------------------------------------------------------------------

## 8. Skill Content Rules

### SKILL.md MUST:

-   Describe scope and responsibility
-   Define when to use / when NOT to use
-   Avoid implementation details
-   Act as a capability declaration

### references/\*.md SHOULD:

-   Be focused on one concept
-   Include examples
-   Include pitfalls and best practices
-   Be safe to load selectively

------------------------------------------------------------------------

## 9. Versioning & Trust

`GENERATION.md` and `SYNC.md` are used to: - Track origin (experience vs
official docs) - Record framework / library versions - Allow Agents to
judge freshness & reliability

------------------------------------------------------------------------

## 10. Routing Rules (Implicit but Mandatory)

Agents operating in this system must follow:

1.  Always load `vite-threejs/SKILL.md` first
2.  Apply framework constraints before application logic
3.  Use `SKILL.md` for routing, not references
4.  Prefer anti-pattern skills when task risk is high
5.  Never bypass framework rules using application skills

------------------------------------------------------------------------

## 11. Evaluation Criterion (Success Definition)

This system is considered successful if:

- Framework Skills can be reused across projects unchanged
- Application Skills can be swapped freely
- Routing logic remains stable over time
- Skill updates do not break discovery
- The Agent can reason without loading full documentation

## End of Context
