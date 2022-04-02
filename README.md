# three-gpu-pathtracer

[![lgtm code quality](https://img.shields.io/lgtm/grade/javascript/g/gkjohnson/three-gpu-pathtracer.svg?style=flat-square&label=code-quality)](https://lgtm.com/projects/g/gkjohnson/three-gpu-pathtracer/)
[![build](https://img.shields.io/github/workflow/status/gkjohnson/three-gpu-pathtracer/Node.js%20CI?style=flat-square&label=build)](https://github.com/gkjohnson/three-gpu-pathtracer/actions)

Path tracing project using [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) to accelerate high quality, physically based rendering on the GPU. Features include support for GGX surface model, material information, textures, normal maps, emission, environment maps, tiled rendering, and more!

_More features and capabilities in progress!_

# Examples

[Lambert demo here](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/lambert.html)!

[Lego demo here](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/lego.html)!

[Material demo here](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/materialBall.html)!

[Ambient Occlusion Material demo here](https://gkjohnson.github.io/three-gpu-pathtracer/example/bundle/aoRender.html)!

# Use

```js
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { PathTracingSceneGenerator, PathTracingRenderer, PhysicalPathTracingMaterial } from 'three-gpu-pathtracer';

// init scene, renderer, camera, controls, etc

// initialize the path tracing material and renderer
const ptMaterial = new PhysicalPathTracingMaterial();
const ptRenderer = new PathTracingRenderer( renderer );
ptRenderer.camera = camera;
ptRenderer.material = ptMaterial;

// init quad for rendering to the canvas
const fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {
	transparent: true,
	map: ptRenderer.target.texture,
} ) );

// initialize the scene and update the material properties with the bvh, materials, etc
const generator = new PathTracingSceneGenerator();
const { bvh, textures, materials } = await generator.generate( scene );
ptMaterial.bvh.updateFrom( bvh );
ptMaterial.normalAttribute.updateFrom( geometry.attributes.normal );
ptMaterial.tangentAttribute.updateFrom( geometry.attributes.tangent );
ptMaterial.uvAttribute.updateFrom( geometry.attributes.uv );
ptMaterial.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
ptMaterial.textures.setTextures( renderer, 2048, 2048, textures );
ptMaterial.materials.updateFrom( materials, textures );
ptMaterial.setDefine( 'MATERIAL_LENGTH', materials.length );
ptRenderer.reset();

// ...

function animate() {

	// update the camera and render one sample
	camera.updateMatrixWorld();
	ptRenderer.update();

  // copy the current state of the path tracer to canvas to display
	renderer.autoClear = false;
	fsQuad.material.map = ptRenderer.target.texture;
	fsQuad.render( renderer );
	renderer.autoClear = true;

}

```

# Exports

## PathTracingRenderer

### constructor

```js
constructor( renderer : WebGLRenderer )
```

### .tiles

```js
tiles = ( 1, 1 ) : Vector2
```

### .samples

```js
samples = 1 : Number
```

### .resetSeed

```js
resetSeed = false
```

### .setSize

```js
setSize( size : Vector2 ) : void
```

### .update

```js
update()
```

### .reset

```js
reset() : void
```

## PathTracingSceneGenerator

_TODO_

## MaterialBase

_extends THREE.ShaderMaterial_

### .setDefine

```js
setDefine( name : string, value = undefined : any )
```

## PhysicalPathTracingMaterial

_extends MaterialBase_

See material implementation page for full list of uniforms and properties.

_TODO_

## RenderTarget2DArray

_extends WebGLArrayRenderTarget_

### .setTextures

```js
setTextures( renderer : WebGLRenderer, width : Number, height : Number, textures : Array<Texture> ) : void
```

## MaterialStructArrayUniform

_extends Array_

### .updateFrom

```js
updateFrom( materials : Array<Material>, textures : Array<Texture> ) : void
```

## MaterialStructUniform

### .updateFrom

```js
updateFrame( material : Material, textures : Array<Texture> ) : void
```

## Functions

### mergeMeshes

```js
mergeMeshes( meshes : Array<Mesh> ) : { TODO }
```

## Shader Chunks

**shaderMaterialSampling**

_TODO_

**shaderStructs**

_TODO_

**shaderUtils**

_TODO_

# Caveats

- All textures must use the same wrap and interpolation flags.

# Screenshots

![](./docs/interior-scene-cropped.png)

<p align="center">
<i>"Interior Scene" model by <a href="https://sketchfab.com/3d-models/interior-scene-45ddbbc4c2dc4f8ca9ed99da9a78326a">Allay Design</a></i>
</p>


![](./docs/neko-stop.png)

<p align="center">
<i>Neko Stop Diorama model by <a href="https://sketchfab.com/3d-models/the-neko-stop-off-hand-painted-diorama-a5ea0bf252884fceabf1007e8050f3fc">Art by Kidd</a></i>
</p>


![](./docs/rover-orange.png)

<p align="center">
<i>Perseverance Rover model by <a href="https://mars.nasa.gov/resources/25042/mars-perseverance-rover-3d-model/">NASA / JPL-Caltech</a></i>
</p>

![](./docs/double-threedscans-envmap.png)

<p align="center">
<i>Sculpture scans model by <a href="https://threedscans.com">Threedscans</a></i>
</p>

![](./docs/lego-death-star-white.png)

![](./docs/lego-x-wing-black.png)

![](./docs/lego-egyptian-white.png)

<p align="center">
<i>Lego models courtesy of the <a href="https://omr.ldraw.org/">LDraw Official Model Repository</a></i>
</p>

### Resources

[Raytracing in One Weekend Book](https://raytracing.github.io/)

[PBR Book](https://pbr-book.org/)

[knightcrawler25/GLSL-PathTracer](https://github.com/knightcrawler25/GLSL-PathTracer/)


