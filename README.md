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
// TODO
```

# Exports

## PathTracingRenderer

_TODO_

## PathTracingSceneGenerator

_TODO_

## PBRPathTracingMaterial

_TODO_

## RenderTarget2DArray

_TODO_

## MaterialStructArrayUniform

_TODO_

## MaterialStructUniform

_TODO_

## Functions

### mergeMeshes

_TODO_

## Shader Chunks

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


