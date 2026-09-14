<!-- This file is generated automatically. Do not edit it directly. -->
# three-gpu-pathtracer/webgpu

## Constants

### TRANSMISSIVE_BACKGROUND_ENVIRONMENT

```js
TRANSMISSIVE_BACKGROUND_ENVIRONMENT: number
```

Sample the environment map, so glass shows what is behind it.

### TRANSMISSIVE_BACKGROUND_OVERLAY

```js
TRANSMISSIVE_BACKGROUND_OVERLAY: number
```

Set the opacity from the transmitted light intensity, tinted by the environment lighting.

### TRANSMISSIVE_BACKGROUND_TRANSPARENT

```js
TRANSMISSIVE_BACKGROUND_TRANSPARENT: number
```

Attenuate the background by the transmitted light, so glass renders against transparency.

## BlurredEnvMapGenerator

Produces a PMREM prefiltered, optionally downsampled equirectangular copy of an environment
map. Blurring removes the small bright details that make an environment slow to converge.


### .constructor

```js
constructor( renderer: WebGPURenderer )
```

### .dispose

```js
dispose(): void
```

Frees every GPU resource held by the generator.


### .generate

```js
async generate(
	texture: Texture,
	blur = 0: number,
	width = null: number,
	height = null: number
): Promise<Texture>
```

Renders a blurred copy of the given environment map. The source texture is left untouched.

> [!NOTE]
> The returned texture is owned by the caller and must be disposed.

## FSRUpscaler

Upscales a path traced image to the drawing buffer size with FSR. Pass one to
"WebGPUPathTracer.setUpscaler".

The "Upscaler" class is passed in rather than imported so it does not become a dependency.

```js
import { Upscaler } from '@pmndrs/upscaler';
pathTracer.setUpscaler( new FSRUpscaler( { Upscaler } ) );
```


### .constructor

```js
constructor(
	{
		Upscaler: function,
		sharpness?: number,
	}
)
```

Every field below can also be assigned after construction.

### .init

```js
init( renderer: WebGPURenderer ): void
```


### .upscale

```js
upscale( source: Texture, camera: Camera ): Texture
```

Upscales a texture to the renderer's drawing buffer size.


## OIDNDenoiser

Runs Open Image Denoise over a path traced image. Pass one to
"WebGPUPathTracer.setDenoiser", or drive it directly with "denoise".

"initUNetFromURL" and the weights are passed in rather than imported so neither the library
nor the network files become a dependency.

```js
import { initUNetFromURL } from 'oidn-web';
pathTracer.setDenoiser( new OIDNDenoiser( { initUNetFromURL, auxWeightsUrl } ) );
```

Weights come from the oidn-weights repository, where the "_small" and "_large" variants trade
quality against download size and per tile cost.


### .texture

```js
texture: ExternalTexture | null
```

The denoised result, or null until the first tile has been produced.


### .complete

```js
complete: boolean
```

Whether a pass has finished. Stays true until reset.


### .running

```js
running: boolean
```

Whether a pass is running. The work is spread over several frames.


### .constructor

```js
constructor(
	{
		initUNetFromURL: function,

		// Weights for the guided model.
		auxWeightsUrl: string,

		// Weights for the color only model, needed only when
		// "useAuxiliaryBuffers" is off.
		colorWeightsUrl?: string,
		useAuxiliaryBuffers?: boolean,
		maxTileSize?: number | null,
		dynamicTile?: boolean | Object | null,
	}
)
```

Every field below can also be assigned after construction.

### .init

```js
init( renderer: WebGPURenderer ): void
```


### .setScene

```js
setScene( scene: Scene, camera: Camera ): void
```


### .update

```js
update( target: Texture ): Texture | null
```

Renders the auxiliary buffers and starts a pass. Safe to call every frame.


### .denoise

```js
async denoise(
	color: Texture,
	albedo = null: Texture | null,
	normal = null: Texture | null
): void
```

Runs a pass unless one is already running or finished. The optional albedo and normal
buffers guide the filter and select the guided model. Both hold [0,1] values, with normals
mapped so a flat normal is (0.5, 0.5, 1).


### .reset

```js
reset(): void
```

Drops any running pass and the last result. Call it whenever the image changes, such as when
the camera moves.


## WebGPUPathTracer

Progressive path tracer running on WebGPU. Call `setScene` once, then
`renderSample` every frame to accumulate samples into the canvas.

The scene is captured when `setScene` is called, so changes to geometry, materials, lights, or
the environment afterward require the matching `update*` function. Any change that invalidates
the accumulated image restarts it.


### .bounces

```js
bounces: number = 15
```

Maximum number of times a ray can scatter before the path is terminated. Higher values
resolve more indirect light at the cost of speed.


### .frameBudget

```js
frameBudget: number = 250000
```

Number of path slots dispatched per `renderSample` call, independent
of resolution. Raising it trades frame rate for convergence speed.


### .maxTransparentBounces

```js
maxTransparentBounces: number = 5
```

Maximum number of alpha tested surfaces a ray can pass through. Counted separately from
`bounces` so foliage and cutouts cannot exhaust the bounce budget.


### .maxSamples

```js
maxSamples: number = 0
```

Stops accumulating once every pixel reaches this many samples. A denoiser only runs once the
render has stopped, so it has no effect while this is `0`.

> [!NOTE]
> `0` renders indefinitely.

### .transmissiveBackground

```js
transmissiveBackground: number = TRANSMISSIVE_BACKGROUND_OVERLAY
```

How the background is treated behind transmissive surfaces. One of
`TRANSMISSIVE_BACKGROUND_OVERLAY`, `TRANSMISSIVE_BACKGROUND_ENVIRONMENT`, or
`TRANSMISSIVE_BACKGROUND_TRANSPARENT`.


### .filterGlossyFactor

```js
filterGlossyFactor: number = 1
```

Blurs sharp reflections seen through rough surfaces to suppress fireflies. Higher values
remove more noise and more detail.

> [!NOTE]
> `0` disables the filter.

### .multipleImportanceSampling

```js
multipleImportanceSampling: boolean = true
```

Whether to combine light sampling and bsdf sampling with MIS. Disabling it makes lights
noticeably noisier.


### .clampDirect

```js
clampDirect: number = 0
```

Upper bound on the contribution of a directly lit path segment, for suppressing fireflies.

> [!NOTE]
> `0` disables the clamp. Clamping darkens the image and biases the result.

### .clampIndirect

```js
clampIndirect: number = 10
```

Upper bound on the contribution of an indirectly lit path segment, for suppressing
fireflies.

> [!NOTE]
> `0` disables the clamp. Clamping darkens the image and biases the result.

### .target

```js
readonly target: Texture | null
```

The render target the accumulated samples are written into.


### .fadeState

```js
readonly fadeState: number
```

Progress of the fade from the low resolution preview to the full render, from 0 to 1.


### .lowResTarget

```js
readonly lowResTarget: Texture
```

The low resolution preview rendered while `renderDelay` elapses.


### .lowResMode

```js
readonly lowResMode: boolean
```

Whether the tracer is currently rendering the low resolution preview.


### .textureAtlas

```js
readonly textureAtlas: AtlasTexture
```

The atlas every scene texture is packed into for the kernels to sample.


### .minSamples

```js
minSamples: number = 1
```

Samples every pixel must reach before the full resolution render is faded in.


### .renderDelay

```js
renderDelay: number = 500
```

Milliseconds to show the low resolution preview for after a reset.


### .fadeDuration

```js
fadeDuration: number = 500
```

Milliseconds taken to cross fade from the preview to the full render.


### .dynamicLowRes

```js
dynamicLowRes: boolean = true
```

Whether to render a low resolution preview while the camera is moving.


### .lowResScale

```js
lowResScale: number = 0.1
```

Resolution of the low resolution preview, as a fraction of the render size.


### .renderScale

```js
renderScale: number = 1
```

Resolution the path tracer renders at, as a fraction of the canvas size. Lowering it
converges faster at the cost of detail, and pairs with an upscaler.


### .synchronizeRenderSize

```js
synchronizeRenderSize: boolean = true
```

Whether to track the canvas size automatically. Turn it off to drive the render size
with `setSize`.


### .generateMissingAttributes

```js
generateMissingAttributes: boolean = true
```

Whether to generate the attributes in `commonAttributes` on
geometry that is missing them when the scene is set.


### .commonAttributes

```js
commonAttributes: Array<string> = [ 'normal', 'tangent' ]
```

Vertex attributes every geometry is expected to provide.


### .stableNoise

```js
stableNoise: boolean = true
```

Whether to restart the random sequence on reset so a given camera always produces the
same image.


### .pause

```js
pause: boolean = false
```

Whether to stop accumulating samples. The last image keeps being presented.


### .random

```js
random: Object = RANDOM_BLUE_DITHER
```

Random number generator the kernels sample with. One of `RANDOM_BLUE_DITHER`,
`RANDOM_SOBOL`, or `RANDOM_PCG`.

> [!NOTE]
> Assign through `setRandom` so the kernels recompile.

### .material

```js
material: PathtracingMaterial
```

Material model the kernels evaluate surfaces with.

> [!NOTE]
> Assign through `setMaterial` so the kernels recompile.

### .constructor

```js
constructor( renderer: WebGPURenderer )
```

### .getSampleCountsAsync

```js
async getSampleCountsAsync(): Promise<SampleCounts>
```

Measures the per pixel sample counts. Use `min` for convergence checks and `avg` to display.

> [!NOTE]
> The wavefront backend reduces the counts on the GPU and reads them back, so only call
>   this when the numbers are needed.

### .useMegakernel

```js
useMegakernel( value: boolean ): void
```

Switches between the two tracing backends and rebuilds the kernels. The wavefront backend is
used by default and is faster on most scenes.


### .setMultipleImportanceSampling

```js
setMultipleImportanceSampling( value: boolean ): void
```


### .setDenoiser

```js
setDenoiser( denoiser: OIDNDenoiser | null ): void
```

Attaches a denoiser, run once the render settles and displayed in place of the raw image.
Settings live on the instance. Pass null to remove it.


### .setUpscaler

```js
setUpscaler( upscaler: FSRUpscaler | null ): void
```

Attaches an upscaler, run before the image is presented so the render can happen below the
canvas resolution. Settings live on the instance. Pass null to remove it.


### .setScene

```js
setScene( scene: Scene, camera: Camera ): void
```

Captures the scene and camera and builds the acceleration structures the kernels trace
against. Call this once, then use the `update*` functions for later changes.

> [!NOTE]
> Geometry BVHs are built synchronously, so this blocks for large scenes.

### .getMaterial

```js
getMaterial(): PathtracingMaterial
```


### .setMaterial

```js
setMaterial( material: PathtracingMaterial ): void
```

Replaces the material model and recompiles the kernels.


### .setRandom

```js
setRandom( random: Object ): void
```

Replaces the random number generator and recompiles the kernels.


### .setCamera

```js
setCamera( camera: Camera ): void
```

Replaces the camera the rays are generated from. Cameras with a `getCameraRayFn`, such as
`PhysicalCamera` and `EquirectCamera`, provide their own ray generation.


### .updateMaterials

```js
updateMaterials(): void
```

Re-reads the material properties and textures from the scene. Call after changing any
material.


### .updateTransforms

```js
updateTransforms(): void
```

Re-reads the world matrices from the scene. Call after moving any object.

> [!NOTE]
> Changing geometry requires `setScene` instead, since the BVH
>   must be rebuilt.

### .updateCamera

```js
updateCamera(): void
```

Re-reads the camera transform and projection. Call after moving the camera.


### .updateEnvironment

```js
updateEnvironment(): void
```

Re-reads `scene.environment` and `scene.background`, along with their intensity, rotation,
and blur.


### .updateLights

```js
updateLights(): void
```

Re-collects the lights in the scene. Call after adding, removing, or changing one.


### .setSize

```js
setSize( x: number, y: number ): void
```

Sets the resolution the path tracer renders at. Only used when
`synchronizeRenderSize` is off.


### .reset

```js
reset(): void
```

Discards the accumulated image and starts over. The `update*` functions call this for you.


### .renderSample

```js
renderSample(): void
```

Accumulates one round of samples and presents the result to the canvas. Call once per frame.


### .renderDebugBounds

```js
renderDebugBounds(
	{
		// Count the top level object bounding boxes.
		displayTLAS = true: boolean,

		// Count the per object geometry bounding boxes.
		displayBLAS = true: boolean,

		// Only count boxes in front of the nearest   hit, so occluded
		// boxes do not contribute. Culling and material transparency
		// are honored.
		stopAtSurface = false: boolean,

		// Node count that saturates to full heat.
		saturationCount = 64: number,
	}
): void
```

Draws a heatmap of how many BVH bounding boxes each camera ray intersects, for diagnosing
box overlap and traversal cost. Hotter pixels traverse more nodes.


### .renderTextureAtlas

```js
renderTextureAtlas( layer = 0: number ): void
```

Draws one layer of the texture atlas to the canvas, for debugging texture packing.


### .renderSampleDensity

```js
renderSampleDensity(): void
```

Draws a heatmap of the per pixel sample counts, for spotting pixels that converge slowly.

> [!NOTE]
> Measures on every call and draws with the previous result, since the readback lands a
>   frame later.

### .dispose

```js
dispose(): void
```

Frees every GPU resource held by the tracer, including any attached denoiser and upscaler.


### .getRenderTime

```js
getRenderTime(): number
```

Milliseconds elapsed since the last reset.


## SampleCounts


### .min

```js
min: number
```

Lowest sample count of any pixel.

### .max

```js
max: number
```

Highest sample count of any pixel.

### .avg

```js
avg: number
```

Mean sample count across the image.

### .samplesPerSecond

```js
samplesPerSecond: number
```

Mean samples accumulated per second since the last reset.
