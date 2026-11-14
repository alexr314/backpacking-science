# Backpacking Science

Open-source tools for the physics of being comfortable outdoors, and the write-ups that go with
them. Each project lives in its own folder.

## Projects

### [will-i-be-cold](will-i-be-cold/)
A steady-state heat-balance calculator for backpackers. Not a layering lookup table: it solves
ISO 11079 IREQ for the clothed phases of a day and ISO 23537 Annex C for sleep, runs them over a
real temperature distribution from a point forecast, and reports **coverage**: where in the range
you might actually face, nothing you own keeps you comfortable.

- `packages/heat`: the physics engine, with no dependencies and no I/O. ISO 11079, ISO 9920,
  ISO 23537, ASTM F3340, ISO 7730.
- `packages/weather`: a keyless Open-Meteo client. Point forecasts with real elevation
  correction, an honest forecast/climatology switch, and encounter probability curves built on a
  measured forecast-error process.
- `packages/island`: the interface.
- `docs/`: the sourced references the engine is built on, including what could **not** be
  verified.

## Why the references matter
`docs/STANDARDS.md` and `docs/CAMPFIRE.md` label every constant `verified`, `single-source` or
`UNVERIFIED`, with the URL it came from. The engine ships a machine-readable register of every
number that is an estimate rather than a measurement, and the interface shows it. Where a standard
contradicts itself, or where a widely repeated figure turns out to be from the wrong regime, the
documents say so.

## Licence
MIT.
