# three-gpu-pathtracer

[![npm version](https://img.shields.io/npm/v/three-gpu-pathtracer.svg?style=flat-square)](https://www.npmjs.com/package/three-gpu-pathtracer)
[![build](https://img.shields.io/github/actions/workflow/status/gkjohnson/three-gpu-pathtracer/node.js.yml?style=flat-square&label=build&branch=main)](https://github.com/gkjohnson/three-gpu-pathtracer/actions)
[![github](https://flat.badgen.net/badge/icon/github?icon=github&label)](https://github.com/gkjohnson/three-gpu-pathtracer/)
[![twitter](https://flat.badgen.net/badge/twitter/@garrettkjohnson/?icon&label)](https://twitter.com/garrettkjohnson)
[![sponsors](https://img.shields.io/github/sponsors/gkjohnson?style=flat-square&color=1da1f2)](https://github.com/sponsors/gkjohnson/)

![](https://user-images.githubusercontent.com/734200/162287477-96696b18-890b-4c1b-8a73-d662e577cc48.png)

Path tracing project using [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and WebGL 2 to accelerate high quality, physically based rendering on the GPU. Features include support for GGX surface model, material information, textures, normal maps, emission, environment maps, tiled rendering, and more!

_More features and capabilities in progress!_

# Examples

**Setup**

[Basic glTF Setup Example](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/basic.html)

[Basic Primitive Geometry Example](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/primitives.html)

**Beauty Demos**

[Physically Based Materials](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/index.html)

[Lego Models](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/lego.html)

[Interior Scene](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/interior.html)

[Depth of Field](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/depthOfField.html)

[HDR Image](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/hdr.html)

**Features**

[Skinned Geometry Support](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/skinnedMesh.html)

[Morph Target Support](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/skinnedMesh.html#morphtarget)

[Area Light Support](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/areaLight.html)

[Spot Light Support](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/spotLights.html)

[Volumetric Fog Support](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/fog.html)

**Test Scenes**

[Material Test Orb](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/materialBall.html)

[Transmission Preset Orb](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/materialBall.html#transmission)

[Model Viewer Fidelity Scene Comparisons](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/viewerTest.html)

[Physical Material Database](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/materialDatabase.html)

**Tools**

[Animation Rendering](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/renderVideo.html)

[Ambient Occlusion Material](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/aoRender.html)

## Running examples locally

To run and modify the examples locally, make sure you have Node and NPM installed.  Check the supported versions in [the test configuration](./.github/workflows/node.js.yml).

In order to install dependencies, you will need `make` and a C++ compiler available.

On Debian or Ubuntu, run `sudo apt install build-essential`.  It should just work on MacOS.

- To install dependencies, run `npm install`
- To start the demos run `npm start`
- Visit `http://localhost:1234/<demo-name.html>`

# Use

**Basic Renderer**

```js
import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

// init scene, camera, controls, etc

renderer = new THREE.WebGLRenderer();
renderer.toneMapping = THREE.ACESFilmicToneMapping;

pathTracer = new WebGLPathTracer( renderer );
pathTracer.setScene( scene, camera );

animate();

function animate() {

	requestAnimationFrame( animate );
	pathTracer.renderSample();

}
```

**Blurred Environment Map**

Using a pre blurred envioronment map can help improve frame convergence time at the cost of sharp environment reflections. If performance is concern then multiple importance sampling can be disabled and blurred environment map used.

```js
import { BlurredEnvMapGenerator } from 'three-gpu-pathtracer';

// ...

const envMap = await new RGBELoader().setDataType( THREE.FloatType ).loadAsync( envMapUrl );
const generator = new BlurredEnvMapGenerator( renderer );
const blurredEnvMap = generator.generate( envMap, 0.35 );

// render!

```

# Exports

## WebGLPathTracer

### constructor

```
constructor( renderer : WebGLRenderer )
```

### .bounces

```js
bounces = 10 : Number
```

Max number of lights bounces to trace.

### .filteredGlossyFactor

```js
filteredGlossyFactor = 0 : Number
```

Factor for alleviating bright pixels from rays that hit diffuse surfaces then specular surfaces. Setting this higher alleviates fireflies but will remove some specular caustics.

### .tiles

```js
tiles = ( 3, 3 ) : Vector2
```

Number of tiles on x and y to render to. Can be used to improve the responsiveness of a page while still rendering a high resolution target.

### .renderDelay

```js
renderDelay = 100 : Number
```

Number of milliseconds to delay rendering samples after the path tracer has been reset.

### .fadeDuration

```js
fadeDuration = 500 : Number
```

How long to take to fade the fully path traced scene in in milliseconds wen rendering to the canvas.

### .minSamples

```js
minSamples = 5 : Number
```

How many samples to render before displaying to the canvas.

### .dynamicLowRes

```js
dynamicLowRes = false : Boolean
```

Whether to render an extra low resolution of the scene while the full resolution renders. The scale is defined by `lowResScale`.

### .lowResScale

```js
lowResScale = 0.1 : Number
```

The scale to render the low resolution pass at.

### .synchronizeRenderSize

```js
synchronizeRenderSize = true : Boolean
```

Whether to automatically update the sie of the path traced buffer when the canvas size changes.

### .renderScale

```js
renderScale = 1 : Number
```

The scale to render the path traced image at. Only relevant if `synchronizeRenderSize` is true.

### .renderToCanvas

```js
renderToCanvas = true : Boolean
```

Whether to automatically render the path traced buffer to the canvas when `renderSample` is called.

### .rasterizeScene

```js
rasterizeScene = true : Boolean
```

Whether to automatically rasterize the scene with the three.js renderer while the path traced buffer is rendering.

### .textureSize

```js
textureSize = ( 1024, 1024 ) : Vector2
```

The dimensions to expand or shrink all textures to so all scene textures can be packed into a single texture array.

### .samples

```js
readonly samples : Number
```

The number of samples that have been rendered.

### .target

```js
readonly target : WebGLRenderTarget
```

The path traced render target. This potentially changes every call to `renderSample`.

### .setScene

```js
setScene( scene : Scene, camera : Camera ) : void
```

Sets the scene and camera to render. Must be called again when the camera object changes, the geometry in the scene changes, or new materials are assigned.

While only changed data is updated it is still a relatively expensive function. Prefer to use the other "update" functions where possible.

### .setSceneAsync

```js
setSceneAsync(
	scene : Scene,
	camera : Camera,
	options = {
		onProgress = null : value => void,
	} : Object
) : void
```

Asynchronous version of `setScene`. Requires calling `setBVHWorker` first.

### .updateCamera

```js
updateCamera() : void
```

Updates the camera parameters. Must be called if any of the parameters on the previously set camera change.

### .updateMaterials

```js
updateMaterials() : void
```

Updates the material properties. Must be called when properties change for any materials already being used.

Note that materials used with WebGLPathTracer support the following additional properties:

```js
// Whether to render the object as completely transparent against the rest
// of the environment so other objects can be composited later
matte = false : Boolean;

// Whether the object should cast a shadow
castShadow = true : Boolean;
```

### .updateEnvironment

```js
updateEnvironment() : void
```

Updates lighting from the scene environment and background properties. Must be called if any associated scene settings change on the set scene object.

### .updateLights

```js
updateLights() : void
```

Updates lights used in path tracing. Must be called if any lights are added or removed or properties change.

### .renderSample

```js
renderSample() : void
```

Render a single sample to the path tracer target. If `renderToCanvas` is true then the image is rendered to the canvas.

### .reset

```js
reset() : void
```

Restart the rendering.

### .dispose

```js
dispose() : void
```

Dispose the path tracer assets. Any materials or textures used must be disposed separately.

## PhysicalCamera

_extends THREE.PerspectiveCamera_

An extension of the three.js PerspectiveCamera with some other parameters associated with depth of field. These parameters otherwise do not affect the camera behavior are are for convenience of use with the PhysicalCameraUniform and pathtracer.

### .focusDistance

```js
focusDistance = 25 : Number
```

The distance from the camera in meters that everything is is perfect focus.

### .fStop

```js
fStop = 1.4 : Number
```

The fstop value of the camera. If this is changed then the `bokehSize` field is implicitly updated.

### .bokehSize

```js
bokehSize : Number
```

The bokeh size as derived from the fStop and focal length in millimeters. If this is set then the fStop is implicitly updated.

### .apertureBlades

```js
apertureBlades = 0 : Number
```

The number of sides / blades on the aperture.

### .apertureRotation

```js
apertureRotation = 0 : Number
```

The rotation of the aperture shape in radians.

### .anamorphicRatio

```js
anamorphicRatio = 1 : Number
```

The anamorphic ratio of the lens. A higher value will stretch the bokeh effect horizontally.

## EquirectCamera

_extends THREE.Camera_

A class indicating that the path tracer should render an equirectangular view. Does not work with three.js raster rendering.

## PhysicalSpotLight

_extends THREE.SpotLight_

### .radius

```js
radius = 0 : Number
```

The radius of the spotlight surface. Increase this value to add softness to shadows.

### .iesMap

```js
iesMap = null : Texture
```

The loaded IES texture describing directional light intensity. These can be loaded with the `IESLoader`.

Premade IES profiles can be downloaded from [ieslibrary.com]. And custom profiles can be generated using [CNDL](https://cndl.io/).

## ShapedAreaLight

_extends THREE.RectAreaLight_

### .isCircular

```js
isCircular = false : Boolean
```

Whether the area light should be rendered as a circle or a rectangle.

## IESLoader

_extends Loader_

Loader for loading and parsing IES profile data. Load and parse functions return a `DataTexture` with the profile contents.

## BlurredEnvMapGenerator

Utility for generating a PMREM blurred environment map that can be used with the path tracer.

### constructor

```js
constructor( renderer : WebGLRenderer )
```

### .generate

```js
generate( texture : Texture, blur : Number ) : DataTexture
```

Takes a texture to blur and the amount to blur it. Returns a new `DataTexture` that has been PMREM blurred environment map that can have distribution data generated for importance sampling.

### .dispose

```js
dispose() : void
```

Disposes of the temporary files and textures for generation.

## GradientEquirectTexture

### .exponent

```js
exponent = 2 : Number
```

### .topColor

```js
topColor = 0xffffff : Color
```

### .bottomColor

```js
bottomColor = 0x000000 : Color
```

### constructor

```js
constructor( resolution = 512 : Number )
```

### .update

```js
update() : void
```

## MaterialBase

_extends THREE.ShaderMaterial_

Convenience base class that adds additional functions and implicitly adds object definitions for all uniforms of the shader to the object.

### .setDefine

```js
setDefine( name : string, value = undefined : any ) : void
```

Sets the define of the given name to the provided value. If the value is set to null or undefined then it is deleted from the defines of the material. If the define changed from the previous value then `Material.needsUpdate` is set to `true`.

## FogVolumeMaterial

_extends MeshStandardMaterial_

A material used for rendering fog-like volumes within the scene. The `color`, `emissive`, and `emissiveIntensity` fields are all used in the render.

> *NOTE*
> Since fog models many particles throughout the scene and cause many extra bounces fog materials can dramatically impact render time.

### .density

The particulate density of the volume.

## DenoiseMaterial

_extends MaterialBase_

Denoise material based on [BrutPitt/glslSmartDeNoise](https://github.com/BrutPitt/glslSmartDeNoise) intended to be the final pass to the screen. Includes tonemapping and color space conversions.

**Uniforms**

```js
{

	// sigma - sigma Standard Deviation
	// kSigma - sigma coefficient
	// kSigma * sigma = radius of the circular kernel
	sigma = 5.0 : Number,
	kSigma = 1.0 : Number,

	// edge sharpening threshold
	threshold = 0.03 : Number,

}
```
<!--

## CompatibilityDetector

Detects whether the path tracer can run on the current device by checking whether struct precision is reliable and the material shader will compile.

### constructor

```js
constructor( renderer : WebGLRenderer, material : Material )
```

Takes a WebGLRenderer to use and material to test again.

### .detect

```js
detect() : {
	pass: Boolean,
	message: String
}
```

Returns `pass === true` if the path tracer can run. If it cannot run then a message is returned indicating why.

-->

# Gotchas

- The project requires use of WebGL2.
- All textures must use the same wrap and interpolation flags.
- SpotLights, DirectionalLights, and PointLights are only supported with MIS.
- Only MeshStandardMaterial and MeshPhysicalMaterial are supported.
- Instanced geometry and interleaved buffers are not supported.
- Emissive materials are supported but do not take advantage of MIS.

# Screenshots

![](https://user-images.githubusercontent.com/734200/162584469-68e6df38-92da-4a13-b352-ca0bdea14548.png)

<p align="center">
<i>Sample materials</i>
</p>

![](https://user-images.githubusercontent.com/734200/163835927-be75d2c0-f27b-4e4b-a3eb-2371043fa5e1.png)

![](https://user-images.githubusercontent.com/734200/163839431-ed75e64d-9ae4-4423-afca-55162a44873e.png)

<p align="center">
<i>"SD Macross City Standoff Diorama" scene by <a href="https://sketchfab.com/3d-models/sd-macross-city-standoff-diorama-b154220f7e7441799d6be2f7ff9658c7">tipatat</a></i>
</p>

![](./docs/interior-scene-cropped.png)

<p align="center">
<i>"Interior Scene" model by <a href="https://sketchfab.com/3d-models/interior-scene-45ddbbc4c2dc4f8ca9ed99da9a78326a">Allay Design</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/161820794-df0da371-ee5c-4368-9e7b-5e7daf6cf3c7.png)

![](https://user-images.githubusercontent.com/734200/162550315-3cdabf40-3dea-4d7d-bcfc-eb543eea2d93.png)

<p align="center">
<i>Perseverance Rover, Ingenuity Helicopter models by <a href="https://mars.nasa.gov/resources/25042/mars-perseverance-rover-3d-model/">NASA / JPL-Caltech</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/161877900-566652e4-c799-4940-bccb-0c8f4cea5387.png)

<p align="center">
<i>Gelatinous Cube model by <a href="https://sketchfab.com/3d-models/gelatinous-cube-e08385238f4d4b59b012233a9fbdca21">glenatron</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/161822206-c27bf594-d648-4735-868e-4baf4e414802.png)

![](https://user-images.githubusercontent.com/734200/161822214-eace4297-03c4-4adc-b472-efe29a862685.png)

<p align="center">
<i>Lego models courtesy of the <a href="https://omr.ldraw.org/">LDraw Official Model Repository</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/161877196-7ae2769e-7e54-4694-9ca8-e8f5219d1c2d.png)

<p align="center">
<i>Octopus Tea model by <a href="https://sketchfab.com/3d-models/cartoon-octopus-takes-a-tea-bath-107260cf0fd24202a67eb037a6c760a5
">AzTiZ</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/173212652-de6a83e5-dd2c-49b5-8ed7-484ff8969b5b.png)
<p align="center">
<i>Botanists Study model by <a href="https://sketchfab.com/3d-models/the-botanists-study-8b7b5743b1c848ed8ea58f5518c44e7e">riikkakilpelainen</a></i>
</p>

![](https://user-images.githubusercontent.com/734200/173170459-849b9343-efe3-4635-8719-346511472965.png)
<p align="center">
<i>Japanese Bridge Garden model by <a href="https://sketchfab.com/3d-models/japanese-bridge-garden-d122e17593eb4012913cde927486d15a">kristenlee</a></i>
</p>

### Resources

[Raytracing in One Weekend Book](https://raytracing.github.io/)

[PBR Book](https://pbr-book.org/)

[knightcrawler25/GLSL-PathTracer](https://github.com/knightcrawler25/GLSL-PathTracer/)

[DassaultSystemes-Technology/dspbr-pt](https://github.com/DassaultSystemes-Technology/dspbr-pt)


