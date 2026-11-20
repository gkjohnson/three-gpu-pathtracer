/** @import { Vector3, WebGPURenderer } from 'three/webgpu' */
import {
	CubeCamera,
	CubeRenderTarget,
	DataTexture,
	EquirectangularReflectionMapping,
	FloatType,
	HalfFloatType,
	LinearFilter,
	NodeMaterial,
	QuadMesh,
	RenderTarget,
	RGBAFormat,
	Scene,
} from 'three/webgpu';
import { Fn, cubeTexture, float, sin, cos, uv, vec3 } from 'three/tsl';
import { SkyMesh } from './SkyMesh.js';

// equirect uv -> world direction, matching three.js' env sampling direction, as in BlurredEnvMapGenerator
const equirectUvToDirection = /*@__PURE__*/ Fn( ( [ coord ] ) => {

	const u = coord.x.sub( 0.5 );
	const v = float( 1.0 ).sub( coord.y );

	const theta = u.mul( 2.0 * Math.PI );
	const phi = v.mul( Math.PI );
	const sinPhi = sin( phi );

	return vec3( sinPhi.mul( cos( theta ) ), cos( phi ), sinPhi.mul( sin( theta ) ) );

} );

/**
 * Renders three.js' sky, with its sun disc, into an equirectangular environment map whose data is on the CPU, so
 * the path tracer can importance sample it. The sky is rendered into a cube map, then unwrapped and read back.
 * TODO: build the environment's sampling CDF on the GPU so the sky doesn't need reading back
 */
export class SkyEnvMapGenerator {

	/**
	 * @param {WebGPURenderer} renderer
	 * @param {number} [cubeSize=256] - Size of each face of the cube map the sky is rendered into.
	 */
	constructor( renderer, cubeSize = 256 ) {

		this.renderer = renderer;

		// the sky without clouds
		this.sky = new SkyMesh();
		this.sky.scale.setScalar( 1000 );
		this.sky.cloudCoverage.value = 0;

		this.scene = new Scene();
		this.scene.add( this.sky );

		this.cubeTarget = new CubeRenderTarget( cubeSize, { type: HalfFloatType } );
		this.cubeCamera = new CubeCamera( 0.1, 10000, this.cubeTarget );

		const material = new NodeMaterial();
		material.colorNode = cubeTexture( this.cubeTarget.texture, equirectUvToDirection( uv() ) );
		material.toneMapped = false;

		this.quad = new QuadMesh( material );
		this.renderTarget = new RenderTarget( 1, 1, { type: FloatType, format: RGBAFormat, depthBuffer: false } );

	}

	/**
	 * Frees every GPU resource held by the generator.
	 */
	dispose() {

		this.sky.geometry.dispose();
		this.sky.material.dispose();
		this.cubeTarget.dispose();
		this.quad.material.dispose();
		this.renderTarget.dispose();

	}

	/**
	 * Renders the sky with the sun in the given direction.
	 *
	 * @param {Vector3} sunDirection - Direction toward the sun.
	 * @param {number} [width=1024] - Width of the map.
	 * @param {number} [height=512] - Height of the map.
	 * @returns {Promise<DataTexture>}
	 * @note The returned texture is owned by the caller and must be disposed.
	 */
	async generate( sunDirection, width = 1024, height = 512 ) {

		const { renderer, renderTarget, quad, sky, scene, cubeCamera } = this;

		sky.sunPosition.value.copy( sunDirection );
		cubeCamera.update( renderer, scene );

		renderTarget.setSize( width, height );
		const prevTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( renderTarget );
		quad.render( renderer );
		renderer.setRenderTarget( prevTarget );

		const data = await renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height );
		const result = new DataTexture( new Float32Array( data ), width, height, RGBAFormat, FloatType );
		result.minFilter = LinearFilter;
		result.magFilter = LinearFilter;
		result.mapping = EquirectangularReflectionMapping;
		result.needsUpdate = true;
		return result;

	}

}
