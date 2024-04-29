# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [0.0.21] - Unreleased
### Fixed
- Reverted transmission BRDF function changes resulting in black artifacts.

### Added
- WebGLPathTracer class for more easily intializing a path tracer.

### Changed
- PathTracingRenderer, DynamicPathTracingSceneGenerator, and more classes have been deprecated in favor of WebGLPathTracer. See new README for API.
- Remove IESLoader in favor of three.js' version.

## [0.0.20] - 2024.02.21
### Fixed
- Adjust peer dependency semver for three-mesh-bvh.

## [0.0.19] - 2024.02.20
### Fixed
- Ensure materials texture is never a degenerate dimension.
- Handle completely black environment maps so they do not corrupt the image.

## [0.0.18] - 2024.02.20
### Fixed
- Transparent textures no longer have the color incorrectly premultiplied by the alpha.
- Fix rounding error issue in tiled rendering logic causing some columns and rows of pixels to not be rendered to.
- Improve hdr map info to be able to handle any texture type.
- Path tracing scene generators no longer crash when an empty scene is provided.
- Native three.js spot light not working correctly.
- Env map clamping which was causing an incorrect circle of color to display at the poles.

### Added
- Support for stratified sampling in addition to PCG and Sobol under the RANDOM_TYPE flag.

### Changed
- Rendering objects with negative scales now requires three-mesh-bvh v0.7.2

## [0.0.17] - 2024.01.18
### Added
- Support for rendering geometry with inverted scales.

### Changed
- Upgrade to three-mesh-bvh v0.7.0.
- AreaLights no longer render the light surface.
- Disabled sobol sampling functionality related to MacOS crashes. It can be re-enabled with the FEATURE_SOBOL define flag.

### Fixed
- Models with a negative scale not rendering correctly.
- Renderer crashing on MacOS devices.
- Renderer crashing on Android devices.
- Rendering not working at all on iOS devices due to lacking support for linearly interpolated Float32 textures.

## [0.0.16] - 2023-07-21
### Fixed
- Reverted change that caused NaN values on some hardware.

## [0.0.15] - 2023-05-20
### Fixed
- Missing file extension.

### Added
- `CompatibilityDetector` to determine whether the path tracer can run on the target platform.
- `DEBUG_MODE` define to PhysicalPathTracingMaterial to render out ray depth.
- `GradientMapMaterial` to map texture values to a color ramp.
- Support for copy function to `ShapedAreaLight`, `PhysicalCamera`, and `PhysicalSpotLight`.

### Changed
- Fog hits no longer count as transparent surface bounces.
- Remove precision workaround for Equirect map.
- Significant refactoring to make more effective use of structs.

## [0.0.14] - 2023-03-05
### Added
- Support for volumetric fog material.
- Disable sampling of the environment map if env intensity is set to 0.0 to improve direct light sampling rate.

### Changed
- Base color is now applied both on the way in and out of a transmissive material.
- Improved performance of env map CDF processing.

### Fixed
- Area light shapes now consistently cast shadows in MIS and non MIS mode

## [0.0.13] - 2023-02-13
### Changed
- `TRANSPARENT_TRAVERSALS` define to `transmissiveBounces` uniform.
- EquirectUniformInfo now defaults to a white environment map so lighting is present by default.
- Add "stepRayOrigin" function for reuse in the path tracer functions.

### Added
- Transmissive materials now traverse more bounces than non transmissive materials for improved quality. See `transmissiveBounces` uniform.
- Support for russian roulette path termination after 3 bounces. See the `FEATURE_RUSSIAN_ROULETTE` flag.
- QuiltPathTracingRenderer to enable rending for the Looking Glass Display.

### Fixed
- PathTracingSceneGenerator / Worker: include point lights and directional lights in the result.
- Translucent and transparent meshes incorrectly completely blocking area and punctual lights.
- Respect the Material "sheen" field.
- Incorrectly squaring the sheen term.
- Iridescence being incorrectly applied to materials.

## [0.0.12] - 2023-01-29
### Fixed
- Added workaround for Windows machines to address case where the shader compilation would fail due to arrays being passed as function arguments.

## [0.0.11] - 2023-01-05
### Fixed
- Incorrect import statement extension.

## [0.0.10] - 2023-01-04
### Fixed
- Equirect sampling CDF offset values causing env maps with 1 bright pixel to be most noticeably incorrect.
- Clearcoat roughness map values not being respected.

## [0.0.9] - 2022-12-31
### Added
- Support for `Material.flatShading` to render flat-shaded materials.
- Support for randomization using Owen-scrambled and shuffled Sobol values enabling sample stratification and image in fewer samples.
- Support for directional lights, point lights.

### Fixed
- Roughness and metalness maps not being assigned correctly.
- Case where textures using shared "Source" with different encodings were not treated as unique.
- Spot Lights no longer have a dark hot spot.

### Changed
- Move "random" functions around.

## [0.0.8] - 2022-12-11
### Fixed
- Three.js semver package version.
- Removed 3 texture sampler units to add room for future features, background map.
- Texture memory leak in `BlurredEnvMapGenerator`.
- PathtracingSceneGenerator / DynamicPathTracingSceneGenerator: both generators now only include visible geometry in the result.

### Added
- `GradientEquirectTexture` class for generating an equirect background texture with a gradient.
- `AttributesTextureArray` class for storing multiple vertex attribute buffers in a sampler array to save texture units.

### Removed
- Removed `FEATURE_GRADIENT_BG` define and bgGradientTop, bgGradientBottom uniforms. Use the new GradientEquirectTexture class instead.
- PhysicalPathTracingMaterial: Removed `normalAttribute`, `tangentAttribute`, `uvAttribute`, and `colorAttribute` uniforms. Use `attributesArray` to store those parameters, instead.
- `MaterialsTexture.setSide` function.

### Changed
- `MaterialsTexture` automatically uses the specified material side unless the object is transmissive - in which case double-sided is used.
- Used textures are now reduced to just those with unique sources.
- `PhysicalPathTracingMaterial.uniforms.environmentRotation` from a `Matrix3` to a `Matrix4`.
- Updated three-mesh-bvh to v0.5.19.
- Rework application of Fresnel based on Joe Shutte's Disney BSDF writeup resulting in improve handling of metalness brightness.
- Use a 1.1 fresnel by default for plastics since it matches GlTF models more exactly.

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
