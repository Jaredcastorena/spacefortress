# Recruitment and variable crew

Implemented locally after v0.1.12; not yet published. Colony schema72; observation/recording9 unchanged.

Open the surface Colony overview and expand Recruitment. Contacting a traveler creates a deterministic candidate without advancing the world RNG or adding crew/supplies. Accept or decline within 180 ticks. Acceptance schedules an independent ferry after 30 ticks at the usable ground home shuttle pad. The colony shuttle can be elsewhere; its passengers, freight and supplies remain separate.

The accepted pad must still exist, be intact, passable and free of fire. A blocked ferry holds for up to 120 further ticks, then diverts without adding people or goods. A repaired pad can receive the arrival at the deadline. Every resolved contact starts a 300-tick cooldown. Repeated contacts use the same machinery.

The panel reports current surface food, breathing mix, safe bunks and breathable shelter. Food below one ration and breathing mix below five units per home crew member plus the prospective arrival trigger warnings. These are simple current-stock thresholds, not an endurance prediction. Habitat shortages warn but do not prohibit acceptance or landing.

An arrival appends one canonical crew ID and spawns at the real pad, with health 100, hunger 28, energy 60 and suit oxygen 80. The traveler brings no colony stock or possessions. Existing movement and needs must take them to food, shelter, rest and work. Only the newcomer is initialized; old crew health, needs, bonds, grief, jobs, claims, cargo and room state are preserved. Each existing peer, including deceased peers, receives a distinct reciprocal relationship entry.

The registry retains up to 64 people including deceased records. IDs are never recycled. Newcomers can cook, manufacture, own a bunk, form relationships and receive care through existing systems. Manufactured food and items retain maker IDs and cannot predate the maker’s arrival.

## Save and control contract

Recruitment state is absent until the first contact. Untouched older hex colonies migrate without adding people, offers or supplies. Pre72 saves require exactly seven founders and reject recruitment metadata. Schema72 requires contiguous crew IDs and permanent arrival records for every nonfounder; strict validation checks offers, outcomes, dates, landing positions and maker identity.

Use `population.contact {}` and `population.respond {offer, accept}` through the shared action registry. Observations expose `colony.derived.population`; recording emits named contact, flight and arrival events. Reading status neither mutates state nor advances RNG.

## Bounded verification

[State and persistence checks](../tests/population.test.js) cover the genuine schema71 fixture, append preservation, deterministic contacts, response rejection, arrival/holding/diversion, repeated contacts, roster limits and malformed history. [Controls](../tests/population-controls.test.js) cover player/agent parity, pure collapsed details and retained focus.

[Integration checks](../tests/population-integration.test.js) use original supplies and player commands for paid workstations, physical arrival, a finite meal, bunk assignment, tool and meal manufacture, and social bonds. A separate controlled injury uses a paid cot and delivered medicine; it grants no healing or movement. Saves retain post-founder products and reject unknown or impossible maker histories.

These checks establish a bounded newcomer integration, not long-term population sustainability. Births, aging, generations, emigration, recruitment costs, factions and institutions remain future work.
