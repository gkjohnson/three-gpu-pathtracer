# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Fixed
- Three.js semver package version.
- Removed 3 texture sampler units to add room for future features, background map.
- Texture memory leak in `BlurredEnvMapGenerator`.

### Added
- `GradientEquirectTexture` class for generating an equirect background texture with a gradient.
- `AttributesTextureArray` class for storing multiple vertex attribute buffers in a sampler array to save texture units.

### Removed
- Removed `FEATURE_GRADIENT_BG` define and bgGradientTop, bgGradientBottom uniforms. Use the new GradientEquirectTexture class instead.
- PhysicalPathTracingMaterial: Removed `normalAttribute`, `tangentAttribute`, `uvAttribute`, and `colorAttribute` uniforms. Use `attributesArray` to store those parameters, instead.
- `MaterialsTexture.setSide` function.

### Changed
- `MaterialsTexture` automatically uses the specified material side unless the object is transmissive - in which case double-sided is used.

## [0.0.7] - 2022-10-15
### Added
- DenoiseMaterial based on "glslSmartDenoise" to smooth the final render.
- Support for vertex colors.
- Support for attenuated transmission.
- PathTracingRenderer.alpha: Docs specifying premuliplied alpha behavior.
- Support for thin film transmission.

### Fixed
- Diffuse materials looking too dark.
- Specular sampling to use perceptual roughness.
- Default specular and ior values to match three.js.

### Changed
- Opacity support now requires setting `material.transparent` to true.

## [0.0.6] - 2022-08-06
### Added
- Support for sheen parameter support
- Support for iridescence parameter support
- Support for lights to the DynamicPathTracingGenerator
- Support for circular area lights
- Support for spot lights
- Add support for specular color and intensity control
- Support for IES Profiles on the new "PhysicalSpotLight" class
- IESLoader for loading IES profiles as textures

### Changed
- PhysicalPathTracingMaterial: Default "environment intensity" from 2.0 to 1.0.

### Fixed
- White hotspots at some glancing angles.

## [0.0.5] - 2022-07-16
### Added
- Support for equirect rendering with EquirectCamera.
- Support for area lights.
- Support for threejs compatible texture transforms.
- Support for Clearcoat properties.
- Support for arrays of objects passed to pathtracer scene generator.

### Fixed
- Black renders on M1 Safari devices.
- Camera ray direction recision issues when scrolling far from the origin.

## [0.0.4] - 2022-06-12
### Fixed
- Textures not working correctly on Pixel 6 due to an issue with `floatBitsToInt`.
- `PathTracingRenderer.alpha` not being able to be changed after rendering.
- Improved reflective behavior for perfectly smooth surfaces.
- Case where partially transparent objects would cast full shadows.

### Added
- Support for material alpha map.
- Ability to disable casting of shadows.
- Support for rendering with Orthographic cameras.
- Support for texture transform properties per texture.

## [0.0.3] - 2022-05-22
### Fixed
- Some black artifacts when rendering with depth of field.
- `DynamicPathTracingSceneGenerator.reset` not correctly resetting the class resulting in errors when calling "generate" again.

### Changed
- Materials to use a texture instead of uniforms to cut down on max uniform errors.
- `SUPPORT_DOF` no longer needs to be explicitly set and will be toggled automatically based on the bokeh size parameter.
- Removed direct support for environment blur with addition of MIS. Instead use `BlurredEnvMapGenerator` to preblur an environment map.
- Antialiasing jitter is now performed per ray in the shader instead of via camera position jitter for improved AA.
- `GRADIENT_BG` define option to `FEATURE_GRADIENT_BG`

### Added
- Support for "matte" material flag.
- Support for Multiple Importance Sampling for the envionment map and an associated "FEATURE_MIS" flag.
- `BlurredEnvMapGenerator` to blur environment maps.
- Support for rendering transparent backgrounds.

### Removed
- Support for gradient environment colors. Use a `DataTexture`, instead.

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
