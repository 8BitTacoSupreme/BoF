        # bride-of-flinkenstein

        ## Problem
        Users should be able to see the available topics and messages and just say "make me a Flink job that shows customer return rates by product for the last three weeks" and it should infer what topics and fields to use, create/validate teh SQL, show a sample desired message or table and then push live. The resultant Flink populated topic should appear alongside the otehrs.

        ## Vision
        Fast, accurate, resource sensitive.

        ## Architecture
        - Pattern: event-driven
        - Test coverage target: 80%

        ## Milestones
        - Cluster is set up and producers hydrate the topics and user can see the data and its schema
- user can enter an NLP and the model turns that into a SQL query which is validated and a sample/expected message appears
- user accepts and the sql query is pushed live and the resultant kafka topic appears with real messages

        ## Current State
        - **Phase 1 complete** — Kafka cluster + producers + schema visibility (infrastructure layer)
        - **Phase 2 complete** — NLP-to-Flink-SQL pipeline with schema-grounded Claude API generation, dt-sql-parser validation, traffic-light UX, Monaco editor, conversational follow-ups (131 backend tests, canonical E2E approved)
        - **Phase 3 active** — SQL submission to Flink, resultant topic appears alongside existing topics

        Last updated: 2026-04-16
