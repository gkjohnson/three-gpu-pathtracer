/** @import { WebGPURenderer } from 'three/webgpu' */
import { EquirectangularReflectionMapping, HalfFloatType, NodeMaterial, QuadMesh, RenderTarget } from 'three/webgpu';
import { Fn, float, sin, cos, uv, vec3 } from 'three/tsl';
import { SkyNode } from './libs/SkyMesh.js';

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
 * Three.js' sky, with its sun disc and without clouds, rendered into an equirectangular environment map. Set the sky's
 * uniforms on "skyNode", eg "skyNode.sunPosition", then call "update" to render it, and use "texture" as the
 * environment.
 */
export class SkyTexture extends RenderTarget {

	/**
	 * @param {number} [width=1024]
	 * @param {number} [height=512]
	 */
	constructor( width = 1024, height = 512 ) {

		super( width, height, { type: HalfFloatType, depthBuffer: false } );
		this.texture.mapping = EquirectangularReflectionMapping;

		this.skyNode = new SkyNode( equirectUvToDirection( uv() ) );
		this.skyNode.cloudCoverage.value = 0;

		const material = new NodeMaterial();
		material.colorNode = this.skyNode;
		material.toneMapped = false;
		this._quad = new QuadMesh( material );

	}

	/**
	 * Renders the sky into the texture.
	 *
	 * @param {WebGPURenderer} renderer
	 */
	update( renderer ) {

		const previousTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( this );
		this._quad.render( renderer );
		renderer.setRenderTarget( previousTarget );

	}

	dispose() {

		super.dispose();
		this._quad.material.dispose();

	}

}
