import { StorageBufferAttribute, Vector2, NodeMaterial } from 'three/webgpu';
import { storage, uniform, wgslFn, uv, varying, positionGeometry } from 'three/tsl';

export class RenderToScreenNodeMaterial extends NodeMaterial {

	get dimensions() {

		return this._dimensionsUniform.value;

	}

	get resultBuffer() {

		return this._resultBufferUniform.value;

	}

	set resultBuffer( v ) {

		this._resultBufferUniform.value = v;

	}

	constructor( params ) {

		super();

		this._resultBufferUniform = storage( new StorageBufferAttribute(), 'vec4' );
		this._dimensionsUniform = uniform( new Vector2() );

		const fragmentShaderParams = {
			resultBuffer: this._resultBufferUniform,
			dimensions: this._dimensionsUniform,
			uv: varying( uv() ),
		};

		this.vertexNode = wgslFn( /* wgsl */ `
			fn noop(position: vec4f) -> vec4f {
				return position;
			}
		` )( { position: positionGeometry } );

		// TODO: Apply gamma correction?
		this.fragmentNode = wgslFn( /* wgsl */ `
			fn blit(
				resultBuffer: ptr<storage, array<vec4f>, read>,
				dimensions: vec2u,
				uv: vec2f,
			) -> vec4f {
				let x = min(u32( uv.x * f32(dimensions.x) ), dimensions.x - 1);
				let y = min(u32( uv.y * f32(dimensions.y) ), dimensions.y - 1);
				let offset = x + y * dimensions.x;
				return resultBuffer[offset];
			}
		` )( fragmentShaderParams );

		this.setValues( params );

	}

}
