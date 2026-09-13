import {
	RenderTarget,
	FloatType,
	HalfFloatType,
	RGBAFormat,
	DataTexture,
	DataUtils,
	EquirectangularReflectionMapping,
	NodeMaterial,
	QuadMesh,
} from 'three/webgpu';
import { Fn, pmremTexture, uniform, uv, vec3, float, sin, cos } from 'three/tsl';

const PI = Math.PI;

// equirect uv -> world direction, matching three.js' env sampling direction
const equirectUvToDirection = /*@__PURE__*/ Fn( ( [ coord ] ) => {

	const u = coord.x.sub( 0.5 );
	const v = float( 1.0 ).sub( coord.y );

	const theta = u.mul( 2.0 * PI );
	const phi = v.mul( PI );
	const sinPhi = sin( phi );

	return vec3( sinPhi.mul( cos( theta ) ), cos( phi ), sinPhi.mul( sin( theta ) ) );

} );

// Produces a PMREM-prefiltered, optionally downsampled equirect copy of an environment map
// that resolves faster in the path tracer.
export class BlurredEnvMapGenerator {

	constructor( renderer ) {

		this.renderer = renderer;

		// set up the pmrem sampling material
		this._blur = uniform( 0 );
		this._pmremNode = pmremTexture( null, equirectUvToDirection( uv() ), this._blur );

		const material = new NodeMaterial();
		material.colorNode = this._pmremNode;
		material.toneMapped = false;

		this.quad = new QuadMesh( material );
		this.renderTarget = new RenderTarget( 1, 1, { type: FloatType, format: RGBAFormat, depthBuffer: false } );

	}

	dispose() {

		// disposes the node's internal PMREMGenerator and its prefiltering render targets
		this._pmremNode.value = null;
		this._pmremNode.dispose();
		this.quad.material.dispose();
		this.renderTarget.dispose();

	}

	async generate( texture, blur = 0, width = null, height = null ) {

		const { renderTarget, quad, renderer } = this;

		// clone the texture so we can ensure references are cleaned up
		const cloned = texture.clone();

		// default to the source resolution
		width = width ?? cloned.image.width;
		height = height ?? cloned.image.height;

		renderTarget.setSize( width, height );
		renderTarget.texture.colorSpace = cloned.colorSpace;

		// update the uniforms
		this._pmremNode.value = cloned;
		this._blur.value = blur;

		// render the blurred equirect to the target
		const prevTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( renderTarget );
		quad.render( renderer );
		renderer.setRenderTarget( prevTarget );

		// read the data back and pack to half float
		const readBuffer = await renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height );
		const buffer = new Uint16Array( width * height * 4 );
		for ( let i = 0, l = buffer.length; i < l; i ++ ) {

			buffer[ i ] = DataUtils.toHalfFloat( readBuffer[ i ] );

		}

		const result = new DataTexture( buffer, width, height, RGBAFormat, HalfFloatType );
		result.minFilter = cloned.minFilter;
		result.magFilter = cloned.magFilter;
		result.wrapS = cloned.wrapS;
		result.wrapT = cloned.wrapT;
		result.mapping = EquirectangularReflectionMapping;
		result.colorSpace = cloned.colorSpace;
		result.needsUpdate = true;

		this._pmremNode.value = null;
		cloned.dispose();

		return result;

	}

}
