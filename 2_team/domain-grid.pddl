(define (domain grid-navigation)
    (:requirements :strips :typing :derived-predicates)
    (:types agent location)

    (:predicates
        (at ?a - agent ?l - location)
        (adj ?l1 - location ?l2 - location)
        (connected ?l1 - location ?l2 - location)
    )

    ;; Define 'connected' as symmetric adj
    (:derived (connected ?l1 ?l2)
        (or (adj ?l1 ?l2) (adj ?l2 ?l1))
    )

    (:action move
        :parameters (?a - agent ?from ?to - location)
        :precondition (and (at ?a ?from) (connected ?from ?to))
        :effect (and (not (at ?a ?from)) (at ?a ?to))
    )
)
