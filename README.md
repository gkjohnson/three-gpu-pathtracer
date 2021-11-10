# three-shader-pathtracing

Set of experiments and examples using [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) to accelerate path tracing on the GPU.

## TODO

### Demos
- Add demo with lambertian path tracer
- Add with high quality path tracer based on CPU implementation
- Add lightmapping demo (using xatlas-web)
- Render lego models

### Tasks
- Add support for multiple lights
- Add support for materials, textures
- Use a 1px white texture for unset textures
- Fallback to regular render during movement, render on top of rasterized render
- ~Add tiled rendering~
- ~Add basic path tracer base class~

### Long Term
- Add checkerboard rendering
- Add support for sphere lights
- Add drag and drop support
