(define (domain grid-navigation-patrol)
    (:requirements 
        :strips 
        :typing 
        :negative-preconditions 
        :conditional-effects
    )

    (:types
        agent
        location
    )

    (:predicates
        (at        ?a - agent    ?l - location)
        (adj       ?l1 - location ?l2 - location)
        (spawn-loc ?l - location)
        (visited   ?l - location)
    )

    (:action move-spawn
        :parameters (?a    - agent
                     ?from - location
                     ?to   - location)
        :precondition (and
            (at ?a ?from)
            (adj ?from ?to)
            (spawn-loc ?to)
            (not (visited ?to))
        )
        :effect (and
            (not (at ?a ?from))
            (at     ?a ?to)
            (visited ?to)
        )
    )

    (:action move-any
        :parameters (?a    - agent
                    ?from - location
                    ?to   - location)
        :precondition (and
            (at ?a ?from)
            (adj ?from ?to)
            (or
                (not (spawn-loc ?to))
                (visited ?to)
            )
        )
        :effect (and
            (not (at ?a ?from))
            (at     ?a ?to)
        )
    )
)
