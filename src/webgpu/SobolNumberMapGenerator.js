import { FloatType, MeshBasicNodeMaterial, NearestFilter, RenderTarget, RGBAFormat } from 'three/webgpu';
import { FullScreenQuad } from 'three/examples/jsm/Addons.js';
import { generateSobolPointFunc } from './nodes/random.wgsl';
import { uv } from 'three/tsl';

const _quad = new FullScreenQuad( new MeshBasicNodeMaterial() );
export class SobolNumberMapGenerator {

	constructor( renderer, dimensions ) {

		this.target = new RenderTarget( dimensions, dimensions, {

			type: FloatType,
			format: RGBAFormat,
			minFilter: NearestFilter,
			maxFilter: NearestFilter,
			generateMipmaps: false,

		} );

		this.renderer = renderer;
		this.dimensions = dimensions;
		this.isGenerated = false;

	}

	get texture() {

		return this.target.texture;

	}

	generate() {

		const { renderer, dimensions, target } = this;

		const ogTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( target );

		_quad.material.colorNode = generateSobolPointFunc(
			uv().x.mul( dimensions ).toUint().add( uv().y.mul( dimensions ).toUint().mul( dimensions ) )
		);
		_quad.render( renderer );

		renderer.setRenderTarget( ogTarget );

		this.isGenerated = true;

	}

}
