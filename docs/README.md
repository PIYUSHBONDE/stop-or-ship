# PlantSense documentation

## Current implementation

- [Observed status](status.md)
- [Repository structure](engineering/repository-structure.md)
- [Architecture](architecture/overview.md) and [production direction](architecture/production.md)
- [Shared case foundation and production blueprint](architecture/case-foundation.md) and [worker startup/recovery](operations/cases.md)
- [Engineering conventions](engineering/conventions.md) and [evaluation boundaries](engineering/evaluation.md)
- [Plant configuration](product/plant-configuration.md)
- [Hackathon product scope and industry-informed boundaries](product/hackathon-delivery.md)
- [Telemetry sources, CSV and API contracts](data/telemetry-sources.md)
- [Dataset attribution](data/attribution.md)
- [Docker operation](operations/docker.md) and [future cloud deployment](operations/deployment.md)
- [Gemini evaluation and quotas](operations/live-gemini.md) and [contextual assistant and voice](operations/assistant.md)

## Retained records

`history/` contains earlier implementation status, reviews and replay documentation. `submission/` contains the draft demonstration script. `artifacts/` retains reviewed screenshots and earlier proposal/recording metadata. These records preserve their original scope; they do not establish live Gemini integration or current cloud deployment.

The authored CSV example under `examples/` illustrates the fixed import format. It is not measured plant data.
