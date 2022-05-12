# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Fixed
- Some black artifacts when rendering with depth of field.
- DynamicPathTracingSceneGenerator.reset not correctly resetting the class resulting in errors when calling "generate" again.

### Changed
- Materials to use a texture instead of uniforms to cut down on max uniform errors.
- `SUPPORT_DOF` no longer needs to be explicitly set and will be toggled automatically based on the bokeh size parameter.
- Removed direct support for environment blur with addition of MIS. Instead use `BlurredEnvMapGenerator` to preblur an environment map.
- Antialiasing jitter is now performed per ray in the shader instead of via camera position jitter for improve AA.
- `GRADIENT_BG` define option to `FEATURE_GRADIENT_BG`

### Added
- Support for "matte" material flag.
- Support for Multiple Importance Sampling for the envionment map and an associated "USE_MIS" flag.
- BlurredEnvMapGenerator to blur environment maps.
- Support for rendering transparent backgrounds.

### Removed
- Support for gradient environment colors. Use a DataTexture, instead.

## [0.0.2] - 2022-04-26
### Added
- Support for material sidedness which must be set explicitly on the material uniforms. See `MaterialStructUniform.side` for more information.
- `DynamicPathTracingSceneGenerator` to support skinned and morph target meshes.
- A `PhysicalCamera` instance and associated shader uniforms and updates to support camera depth of field and shaped bokeh.
- `PathTracingSceneWorker` as separate from the synchronous `PathTracingSceneGenerator` to support more build processes.
- Support for morph target, skinned meshes to scene generators.

### Changed
- `PhysicalPathTracingMaterial` to have a "bounces" uniform rather than define.
- `PathTracingSceneGenerator` is now synchronous.

### Fixed
- Case where material arrays did not work correctly.

## [0.0.1] - 2022-04-08

Initial release with support for path tracing physically based materials with properties including metalness, transmission, roughness, opacity, alpha cutout, and more!
