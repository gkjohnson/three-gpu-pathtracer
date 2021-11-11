# three-shader-pathtracing

Set of experiments and examples using [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) to accelerate path tracing on the GPU.

## TODO

### Demos
- Add demo with lambertian path tracer
- Add with high quality path tracer based on CPU implementation
- Add lightmapping demo (using xatlas-web)
- Render lego models

### Lambert Demo
- Toggle-able models
- Add toggle-able environment maps
- Add option specify gradient background
- Deduped materials
- Fix mobile phone support
- GUI Toggles
  - Set tiles
  - Set bounces
  - Set background / envmap
- ~Add emission support~

### Tasks
- Add support for multiple lights
- Fallback to regular render during movement, render on top of rasterized render
- ~Add support for materials, textures~
- ~Use a 1px white texture for unset textures~
- ~Add tiled rendering~
- ~Add basic path tracer base class~

### Long Term
- Dedupe materials
- Use data texture for material packing
- Add checkerboard rendering
- Add support for sphere lights
- Add drag and drop support
