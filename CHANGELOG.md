# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Added
- Support for material sidedness which must be set explicitly on the material uniforms. See `MaterialStructUniform.side` for more information.
- "synchronous" flag to PathTracingSceneGenerator.
- "DynamicPathTracingSceneGenerator" to support skinned and morph target meshes.

### Changed
- `PhysicalPathTracingMaterial` to have a "bounces" uniform rather than define.

### Fixed
- Case where material arrays did not work correctly.

## [0.0.1] - 2022-04-08

Initial release with support for path tracing physically based materials with properties including metalness, transmission, roughness, opacity, alpha cutout, and more!
